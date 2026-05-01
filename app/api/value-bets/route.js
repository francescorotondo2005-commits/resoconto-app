import { NextResponse } from 'next/server';
import { getDb, getSetting } from '@/lib/db';
import { parseMarketName, getMatchStatValue } from '@/lib/grading';
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from '@/lib/engine';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO } from '@/lib/probability';
import { getCategory, generateCustomMarket, getAllMarkets } from '@/lib/markets';
import { INDICE_ARBITRO_AVANZATO } from '@/lib/referee';
import { calcHistorySummary, calcFormSummary } from '@/lib/history';



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

    // 1b. Fetch pending_matches per ricavare gli arbitri attualmente impostati
    const pendingRes = await db.execute('SELECT * FROM pending_matches');
    const pendingMap = {};
    for (const r of pendingRes.rows) {
      pendingMap[r.match_key] = r;
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

      // 3.b Applicazione Rating Arbitro se la partita in pending lo possiede
      const pendingInfo = pendingMap[matchKey];
      const matchReferee = pendingInfo?.referee || null;

      if (matchReferee) {
        const refFalli = INDICE_ARBITRO_AVANZATO(matchReferee, 'falli', matches);
        const refCartellini = INDICE_ARBITRO_AVANZATO(matchReferee, 'cartellini', matches);

        const applyRating = (statKey, rating) => {
          if (!evsd[statKey]) return;
          evsd[statKey].casa.ev *= rating;
          evsd[statKey].casa.sd *= rating;
          evsd[statKey].ospite.ev *= rating;
          evsd[statKey].ospite.sd *= rating;
          evsd[statKey].totale.ev *= rating;
          evsd[statKey].totale.sd *= rating;
        };

        applyRating('falli', refFalli);
        applyRating('cartellini', refCartellini);
      }

      // Referee rating passed through 
      const refereeRating = matchReferee;

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

        // We only care about edges strictly > 0 for Scanner AND Probability >= minProb
        if (bestEdge > 0 && probability >= minProb) {
          
          // Calcolo Hist e Form usando le stesse logiche del backtest
          const parsed = parseMarketName(marketDef.name);
          let hist = null;
          let form = null;
          if (parsed) {
            hist = calcHistorySummary(homeTeam, awayTeam, matchReferee, marketDef.name, matches);
            form = calcFormSummary(homeTeam, awayTeam, matchReferee, marketDef.name, matches, 5);
          }

          const inGioco = pendingInfo?.in_gioco === 1;

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
            odds_sportium: mktRow.sportium || null,
            edge_sportium: sportiumEdge > -900 ? Math.round(sportiumEdge * 10000) / 10000 : null,
            odds_sportbet: mktRow.sportbet || null,
            edge_sportbet: sportbetEdge > -900 ? Math.round(sportbetEdge * 10000) / 10000 : null,
            historyMessage,
            refereeRating: refereeRating,
            inGioco,
          });
        }
      }
    }

    // Sort: partite attive prima (edge desc), partite in gioco in fondo (edge desc)
    valueBets.sort((a, b) => {
      if (a.inGioco !== b.inGioco) return a.inGioco ? 1 : -1;
      return b.edge - a.edge;
    });

    return NextResponse.json({ valueBets });
  } catch (error) {
    console.error('Value bets scanner error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
