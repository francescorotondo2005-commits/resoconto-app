import { NextResponse } from 'next/server';
import { getDb, getSetting } from '@/lib/db';
import { parseMarketName, getMatchStatValue } from '@/lib/grading';
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from '@/lib/engine';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO } from '@/lib/probability';
import { getCategory, generateCustomMarket, getAllMarkets } from '@/lib/markets';
import { INDICE_ARBITRO_AVANZATO } from '@/lib/referee';
import { calcHistorySummary, calcFormSummary, calcFormScore } from '@/lib/history';

async function getMLPredictions(homeTeam, awayTeam, referee, league) {
  const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL;
  if (!SCRAPER_SERVICE_URL) {
    throw new Error('SCRAPER_SERVICE_URL non configurato in .env.local. Il Machine Learning è disabilitato.');
  }

  try {
    const mlUrl = SCRAPER_SERVICE_URL.replace(/\/$/, '') + '/ml-predict';
    const mlRes = await fetch(mlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify({ homeTeam, awayTeam, referee, league }),
      signal: AbortSignal.timeout(30000)
    });
    if (!mlRes.ok) throw new Error(`Risposta negativa dal server ML (${mlRes.status})`);
    const data = await mlRes.json();
    return data.predictions || null;
  } catch (e) {
    throw new Error(`Impossibile generare le stime ML per ${homeTeam}-${awayTeam}. Assicurati che lo script start.bat sia in esecuzione. Errore: ${e.message}`);
  }
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

    // 2. Fetch matches to ensure it is not closed and to do analysis
    const leaguesNeeded = [...new Set(Object.keys(oddsByMatch).map(k => k.split('|')[0]))];
    const matchesByLeague = {};
    for (const l of leaguesNeeded) {
      const matchesRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ?', args: [l] });
      matchesByLeague[l] = matchesRes.rows;
    }

    const validMatchKeys = [];
    const mlPromises = [];

    for (const matchKey of Object.keys(oddsByMatch)) {
      const [league, homeTeam, awayTeam] = matchKey.split('|');
      const groupData = oddsByMatch[matchKey];
      const matches = matchesByLeague[league];
      
      const matchFinished = matches.some(m => 
        m.home_team === homeTeam && 
        m.away_team === awayTeam && 
        new Date(m.created_at) > new Date(groupData.created_at)
      );

      if (matchFinished) continue;
      
      validMatchKeys.push(matchKey);
      const pendingInfo = pendingMap[matchKey];
      const matchReferee = pendingInfo?.referee || null;
    }

    // Fetch ML Predictions for all valid matches in BATCH mode for extreme speed
    const mlPredictionsByMatch = {};
    if (validMatchKeys.length > 0) {
      const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL;
      if (!SCRAPER_SERVICE_URL) {
        throw new Error('SCRAPER_SERVICE_URL non configurato in .env.local.');
      }

      const batchPayload = validMatchKeys.map(matchKey => {
        const [league, home, away] = matchKey.split('|');
        return { home, away, referee: pendingMap[matchKey]?.referee || '', league };
      });

      try {
        const mlUrl = SCRAPER_SERVICE_URL.replace(/\/$/, '') + '/ml-predict-batch';
        const mlRes = await fetch(mlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({ matches: batchPayload }),
          signal: AbortSignal.timeout(60000)
        });

        if (!mlRes.ok) {
          throw new Error(`Risposta negativa dal server ML Batch (${mlRes.status})`);
        }

        const data = await mlRes.json();
        if (data.success && data.results) {
          data.results.forEach((preds, idx) => {
            mlPredictionsByMatch[validMatchKeys[idx]] = preds;
          });
        }
      } catch (e) {
        throw new Error(`Errore caricamento Batch ML: ${e.message}. Assicurati che lo script start.bat sia in esecuzione.`);
      }
    }



    for (const matchKey of validMatchKeys) {
      const [league, homeTeam, awayTeam] = matchKey.split('|');
      const groupData = oddsByMatch[matchKey];
      const matches = matchesByLeague[league];
      const mlPredictions = mlPredictionsByMatch[matchKey];

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
          // Applica SOLO all'EV classico — la SD rimane pura per il calcolo ML
          // (l'arbitro è già nelle feature del modello Python)
          evsd[statKey].casa.ev *= rating;
          evsd[statKey].ospite.ev *= rating;
          evsd[statKey].totale.ev *= rating;
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

        let fairOdds = probability > 0 ? 1 / probability : 999;
        let minimumOdds = probability >= minProb ? (1 + minEdge) / probability : null;

        // --- INTEGRAZIONE MACHINE LEARNING ---
        if (mlPredictions && mlPredictions[marketDef.stat]) {
          let evMl = null;
          let cvMl = null, probMl = null, fairOddsMl = null, minOddsMl = null;

          const scope = marketDef.scope === 'casa' ? 'casa' : marketDef.scope === 'ospite' ? 'ospite' : null;
          if (scope) {
            evMl = mlPredictions[marketDef.stat][scope];
          } else if (marketDef.type === 'over_under') {
            evMl = Math.round((mlPredictions[marketDef.stat].casa + mlPredictions[marketDef.stat].ospite) * 100) / 100;
          } else if (marketDef.type === '1x2') {
            evMl = marketDef.esito === '1' ? mlPredictions[marketDef.stat].casa
                 : marketDef.esito === '2' ? mlPredictions[marketDef.stat].ospite
                 : Math.round((mlPredictions[marketDef.stat].casa + mlPredictions[marketDef.stat].ospite) / 2 * 100) / 100;
          }

          if (evMl !== null) {
            cvMl = CV_CALC(evMl, sd);
            if (marketDef.type === 'over_under') {
              probMl = PROB_BINOM_NEG(marketDef.line, evMl, sd, marketDef.direction);
            } else if (marketDef.type === '1x2') {
              const evCasaMl = mlPredictions[marketDef.stat].casa;
              const evOspiteMl = mlPredictions[marketDef.stat].ospite;
              const sdCasa = evsd[marketDef.stat].casa.sd;
              const sdOspite = evsd[marketDef.stat].ospite.sd;
              probMl = PROB_1X2_IBRIDO(evCasaMl, sdCasa, evOspiteMl, sdOspite, marketDef.esito);
            }

            if (probMl !== null) {
              fairOddsMl = probMl > 0 ? 1 / probMl : 999;
              minOddsMl = probMl >= minProb ? (1 + minEdge) / probMl : null;
            }

            ev = evMl;
            cv = cvMl;
            probability = probMl;
            fairOdds = fairOddsMl;
            if (minOddsMl !== null) minimumOdds = minOddsMl;
          }
        }
        // -------------------------------------

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
            histScore: hist?.histScore ?? null,
            formScore: calcFormScore(form),
            hist,
            form,
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
