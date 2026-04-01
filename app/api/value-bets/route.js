import { NextResponse } from 'next/server';
import { getDb, getSetting } from '@/lib/db';
import { parseMarketName, getMatchStatValue } from '@/lib/grading';
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from '@/lib/engine';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO } from '@/lib/probability';
import { getCategory, generateCustomMarket, getAllMarkets } from '@/lib/markets';
import { INDICE_ARBITRO_AVANZATO } from '@/lib/referee';

function checkHistoricalCondition(parsedMkt, match, teamRole) {
  // teamRole is 'home' or 'away' relative to the historical match we are evaluating
  const { type, stat, scope, direction, line, esito } = parsedMkt;
  
  // If scope is totale, we just use the original getMatchStatValue because it evaluates both teams.
  let actualValue = 0;
  if (scope === 'totale') {
    actualValue = getMatchStatValue(match, stat, 'totale');
  } else {
    // If original scope was 'casa', it referred to the HomeTeam of the original match.
    // So we are tracking that specific team's raw performance.
    // Depending on whether that team is currently playing at Home or Away in this historical match:
    if (teamRole === 'home') {
      actualValue = getMatchStatValue(match, stat, 'casa');
    } else {
      actualValue = getMatchStatValue(match, stat, 'ospite');
    }
  }

  if (type === 'over_under') {
    if (direction === 'over') return actualValue > line;
    if (direction === 'under') return actualValue < line;
  } else if (type === '1x2') {
    // 1x2 historically means "Did this team win/draw/lose?"
    // esito '1' meant the original Home team won.
    // So we are tracking "team victory".
    const homeVal = getMatchStatValue(match, stat, 'casa');
    const awayVal = getMatchStatValue(match, stat, 'ospite');
    
    // Evaluate if the tracked team won
    let teamWon = false;
    let teamDraw = (homeVal === awayVal);
    let teamLost = false;

    if (teamRole === 'home') {
      teamWon = homeVal > awayVal;
      teamLost = homeVal < awayVal;
    } else {
      teamWon = awayVal > homeVal;
      teamLost = awayVal < homeVal;
    }

    // esito translates to: '1' meaning the tracked team won, 'X' draw, '2' meaning tracked team lost (since original bet meant opponent wins).
    // Wait, if scoping was originally '1' for Casa. 
    // It's safer if 1x2 is just mapped purely:
    if (esito === '1') return teamWon; // The team we are tracking was Casa, '1' means Casa wins.
    if (esito === 'X') return teamDraw;
    if (esito === '2') return teamLost;
  }
  return false;
}

function calculateTrendLabel(teamName, parsedMkt, matches) {
  let totalMatches = 0;
  let totalHits = 0;
  
  let homeMatches = 0;
  let homeHits = 0;
  
  let awayMatches = 0;
  let awayHits = 0;

  for (const m of matches) {
    if (m.home_team === teamName) {
      totalMatches++;
      homeMatches++;
      if (checkHistoricalCondition(parsedMkt, m, 'home')) {
        totalHits++;
        homeHits++;
      }
    } else if (m.away_team === teamName) {
      totalMatches++;
      awayMatches++;
      if (checkHistoricalCondition(parsedMkt, m, 'away')) {
        totalHits++;
        awayHits++;
      }
    }
  }

  if (totalMatches === 0) return `${teamName}: Nessun dato disponibile.`;

  const totalPct = Math.round((totalHits / totalMatches) * 100);
  
  let result = `${teamName}: verificato ${totalHits} volte su ${totalMatches} (${totalPct}%)`;
  
  const additionalDetails = [];
  if (homeMatches > 0) {
    const homePct = Math.round((homeHits / homeMatches) * 100);
    additionalDetails.push(`${homeHits} volte su ${homeMatches} in casa (${homePct}%)`);
  }
  if (awayMatches > 0) {
    const awayPct = Math.round((awayHits / awayMatches) * 100);
    additionalDetails.push(`${awayHits} volte su ${awayMatches} in trasferta (${awayPct}%)`);
  }

  if (additionalDetails.length > 0) {
    result += `, di cui ${additionalDetails.join(' e ')}`;
  }

  return result + ".";
}

export async function GET(request) {
  try {
    const db = await getDb();
    
    // 1. Fetch all match_odds
    const oddsRes = await db.execute({
      sql: 'SELECT * FROM match_odds WHERE sportium IS NOT NULL OR sportbet IS NOT NULL',
      args: []
    });
    const oddsRows = oddsRes.rows;

    if (oddsRows.length === 0) {
      return NextResponse.json({ valueBets: [] });
    }

    // Group by match_key
    const oddsByMatch = {};
    for (const row of oddsRows) {
      if (!oddsByMatch[row.match_key]) oddsByMatch[row.match_key] = {
        created_at: row.created_at,
        markets: []
      };
      // take latest created_at loosely
      if (new Date(row.created_at) > new Date(oddsByMatch[row.match_key].created_at)) {
        oddsByMatch[row.match_key].created_at = row.created_at;
      }
      oddsByMatch[row.match_key].markets.push(row);
    }

    const minProb = parseFloat(await getSetting('min_probability') || '0.65');
    const minEdge = parseFloat(await getSetting('min_edge') || '0.20'); // Optional, we will just use > 0

    const valueBets = [];

    // Base market references
    const baseMarkets = getAllMarkets();

    for (const matchKey of Object.keys(oddsByMatch)) {
      const [league, homeTeam, awayTeam] = matchKey.split('|');
      const groupData = oddsByMatch[matchKey];
      
      // 2. Fetch matches to ensure it is not closed and to do analysis
      const matchesRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ?', args: [league] });
      const matches = matchesRes.rows;

      // Unfinished match validation:
      // Does a match exist for home vs away with created_at > odds.created_at?
      const matchFinished = matches.some(m => 
        m.home_team === homeTeam && 
        m.away_team === awayTeam && 
        new Date(m.created_at) > new Date(groupData.created_at)
      );

      // If the user already graded it, we skip!
      if (matchFinished) continue;

      // 3. Mathematical Evaluation
      const stats = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate'];
      const evsd = {};

      for (const stat of stats) {
        evsd[stat] = {
          casa: {
            ev: EV_AVANZATO(homeTeam, awayTeam, stat, 'casa', matches),
            sd: SD_AVANZATO(homeTeam, awayTeam, stat, 'casa', matches),
          },
          ospite: {
            ev: EV_AVANZATO(homeTeam, awayTeam, stat, 'ospite', matches),
            sd: SD_AVANZATO(homeTeam, awayTeam, stat, 'ospite', matches),
          },
        };
        evsd[stat].casa.cv = CV_CALC(evsd[stat].casa.ev, evsd[stat].casa.sd);
        evsd[stat].ospite.cv = CV_CALC(evsd[stat].ospite.ev, evsd[stat].ospite.sd);
        evsd[stat].totale = {
          ev: evsd[stat].casa.ev + evsd[stat].ospite.ev,
          sd: Math.sqrt(Math.pow(evsd[stat].casa.sd, 2) + Math.pow(evsd[stat].ospite.sd, 2)),
        };
        evsd[stat].totale.cv = CV_CALC(evsd[stat].totale.ev, evsd[stat].totale.sd);
      }

      // Referee rating omitted for global view, defaults to null for bets
      const refereeRating = null;

      // 4. Process each saved odd for this match
      for (const mktRow of groupData.markets) {
        // Find or build the market definition
        let marketDef = null;
        if (mktRow.is_custom === 1) {
          marketDef = generateCustomMarket(
            mktRow.custom_stat,
            mktRow.custom_type,
            mktRow.custom_scope,
            mktRow.custom_direction,
            mktRow.custom_line,
            mktRow.custom_esito
          );
        } else {
          marketDef = baseMarkets.find(m => m.name === mktRow.market_name);
        }

        if (!marketDef) continue;

        let ev, sd, cv, probability;

        if (marketDef.type === 'over_under') {
          if (marketDef.scope === 'casa') {
            ev = evsd[marketDef.stat].casa.ev;
            sd = evsd[marketDef.stat].casa.sd;
          } else if (marketDef.scope === 'ospite') {
            ev = evsd[marketDef.stat].ospite.ev;
            sd = evsd[marketDef.stat].ospite.sd;
          } else {
            ev = evsd[marketDef.stat].totale.ev;
            sd = evsd[marketDef.stat].totale.sd;
          }
          cv = CV_CALC(ev, sd);
          probability = PROB_BINOM_NEG(marketDef.line, ev, sd, marketDef.direction);
        } else if (marketDef.type === '1x2') {
          const evCasa = evsd[marketDef.stat].casa.ev;
          const sdCasa = evsd[marketDef.stat].casa.sd;
          const evOspite = evsd[marketDef.stat].ospite.ev;
          const sdOspite = evsd[marketDef.stat].ospite.sd;

          ev = marketDef.esito === '1' ? evCasa : marketDef.esito === '2' ? evOspite : (evCasa + evOspite) / 2;
          sd = marketDef.esito === '1' ? sdCasa : marketDef.esito === '2' ? sdOspite : Math.sqrt((sdCasa ** 2 + sdOspite ** 2) / 2);
          cv = CV_CALC(ev, sd);
          probability = PROB_1X2_IBRIDO(evCasa, sdCasa, evOspite, sdOspite, marketDef.esito);
        }

        const fairOdds = probability > 0 ? 1 / probability : 999;
        const minimumOdds = probability >= minProb ? (1 + minEdge) / probability : null;

        // Calculate Edge
        const sportiumEdge = mktRow.sportium ? (probability * mktRow.sportium) - 1 : -999;
        const sportbetEdge = mktRow.sportbet ? (probability * mktRow.sportbet) - 1 : -999;
        
        let bestEdge = Math.max(sportiumEdge, sportbetEdge);
        let bestBook = null;
        let actualOdds = null;

        if (bestEdge > -900) {
          if (bestEdge === sportiumEdge) {
            bestBook = 'Sportium';
            actualOdds = mktRow.sportium;
          } else {
            bestBook = 'Sportbet';
            actualOdds = mktRow.sportbet;
          }
        }

        // We only care about edges strictly > 0 for Scanner
        if (bestEdge > 0 && probability > 0) {
          
          // Generate Historical Hit Rate Message
          const parsed = parseMarketName(marketDef.name);
          let historyMessage = '';
          if (parsed) {
             const homeMessage = calculateTrendLabel(homeTeam, parsed, matches);
             const awayMessage = calculateTrendLabel(awayTeam, parsed, matches);
             // Formal format
             historyMessage = `<div style="margin-bottom: 12px; line-height: 1.6;"><strong>${homeTeam}</strong>: L'esito si è ${homeMessage.substring(homeMessage.indexOf(':') + 2)}</div><div style="line-height: 1.6;"><strong>${awayTeam}</strong>: L'esito si è ${awayMessage.substring(awayMessage.indexOf(':') + 2)}</div>`;
          } else {
             historyMessage = "Dati storici non parseabili per questa scommessa.";
          }

          valueBets.push({
            matchKey,
            league,
            homeTeam,
            awayTeam,
            matchStr: `${homeTeam} - ${awayTeam}`,
            name: marketDef.name,
            category: getCategory(marketDef.stat),
            ev: Math.round(ev * 100) / 100,
            sd: Math.round(sd * 100) / 100,
            cv: Math.round(cv * 100) / 100,
            probability: Math.round(probability * 10000) / 10000,
            fairOdds: Math.round(fairOdds * 100) / 100,
            minOdds: minimumOdds ? Math.round(minimumOdds * 100) / 100 : null,
            bookmaker: bestBook,
            actualOdds,
            edge: Math.round(bestEdge * 10000) / 10000,
            historyMessage,
            refereeRating: null, // Global edge context, assuming arbitrary referee
          });
        }
      }
    }

    // Sort globally by Edge descending
    valueBets.sort((a, b) => b.edge - a.edge);

    return NextResponse.json({ valueBets });
  } catch (error) {
    console.error('Value bets scanner error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
