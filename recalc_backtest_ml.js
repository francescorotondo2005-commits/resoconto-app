const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { execFile } = require('child_process');

// Costruisci le dipendenze minimali
const { EV_AVANZATO, SD_AVANZATO, CV_CALC } = require('./lib/engine.js');
const { PROB_BINOM_NEG, PROB_1X2_IBRIDO } = require('./lib/probability.js');
const { INDICE_ARBITRO_AVANZATO } = require('./lib/referee.js');
const { getAllMarkets, generateCustomMarket } = require('./lib/markets.js');
const baseMarkets = getAllMarkets();

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL || 'file:resoconto.db', authToken: env.TURSO_AUTH_TOKEN });

  console.log("1/5 Fetching data from database...");
  const resBets = await db.execute("SELECT * FROM backtest_bets");
  const bets = resBets.rows;

  const resMatches = await db.execute("SELECT * FROM matches ORDER BY date ASC");
  const allMatches = resMatches.rows;

  if (bets.length === 0) {
    console.log("No backtest bets found. Exiting.");
    return;
  }

  // Identifica i match unici nel backtest
  const uniqueMatchesMap = new Map();
  for (const b of bets) {
    if (!uniqueMatchesMap.has(b.match_key)) {
      const [league, home, away] = b.match_key.split('|');
      
      // Cerca l'arbitro
      let referee = null;
      const m = allMatches.find(m => m.home_team === home && m.away_team === away);
      if (m) referee = m.referee;

      uniqueMatchesMap.set(b.match_key, { home, away, referee: referee || '' });
    }
  }

  const uniqueMatches = Array.from(uniqueMatchesMap.values());
  console.log(`2/5 Running ML Predictions for ${uniqueMatches.length} unique matches...`);

  // Write batch file
  const batchFilePath = path.join(__dirname, 'temp_batch_ml.json');
  fs.writeFileSync(batchFilePath, JSON.stringify(uniqueMatches));

  const mlPredictions = await new Promise((resolve, reject) => {
    execFile('python', ['ml_predict.py', '--batch-file', 'temp_batch_ml.json'], { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error("Invalid ML output: " + stdout.substring(0, 200)));
      }
    });
  });

  fs.unlinkSync(batchFilePath);

  // Map predictions back to matchKey
  const mlPredsByKey = {};
  const uniqueKeys = Array.from(uniqueMatchesMap.keys());
  for (let i = 0; i < uniqueKeys.length; i++) {
    mlPredsByKey[uniqueKeys[i]] = mlPredictions[i];
  }

  console.log("3/5 Recalculating Probabilities and Edges...");

  const updates = [];

  for (const b of bets) {
    const [league, homeTeam, awayTeam] = b.match_key.split('|');
    const preds = mlPredsByKey[b.match_key];

    if (!preds) continue;

    // Past matches for SD calculation
    const pastMatches = allMatches.filter(m => m.date < b.match_date && m.league === league);

    // Rebuild marketDef
    let marketDef = null;
    if (b.is_custom === 1) {
      marketDef = generateCustomMarket(b.custom_stat, b.custom_type, b.custom_scope, b.custom_direction, b.custom_line, b.custom_esito);
    } else {
      // Find from baseMarkets
      for (const m of baseMarkets) {
        // Formatta il bet_name in base al format del market per capire se matcha
        // Ma e' piu' sicuro estrarre dalla lista di baseMarkets iterandoli se hanno nome uguale? 
        // No, b.bet_name non e' `marketDef.name`. `mktRow.market_name` in odds map is not available here.
        // Wait, b.bet_name was generated.
        // I can just find marketDef by analyzing b.bet_name.
        // Actually, we can use the `baseMarkets` and see which one generates `b.bet_name` when called with team names!
      }
    }

    // Wait, backtest_bets doesn't save marketDef directly, but it saves bet_name!
    // Let's implement a robust way to find marketDef.
    let foundMarketDef = marketDef;
    if (!foundMarketDef && b.is_custom === 0) {
      for (const m of baseMarkets) {
        const generatedName = typeof m.format === 'function' ? m.format(homeTeam, awayTeam) : m.name;
        if (generatedName === b.bet_name) {
          foundMarketDef = m;
          break;
        }
      }
    }

    if (!foundMarketDef) continue; // Skip if we can't find it (rare)

    // Compute EV using ML, SD using AVANZATO
    let evMl = null;
    const scope = foundMarketDef.scope === 'casa' ? 'casa' : foundMarketDef.scope === 'ospite' ? 'ospite' : null;
    if (scope) {
      evMl = preds[foundMarketDef.stat][scope];
    } else if (foundMarketDef.type === 'over_under') {
      evMl = Math.round((preds[foundMarketDef.stat].casa + preds[foundMarketDef.stat].ospite) * 100) / 100;
    } else if (foundMarketDef.type === '1x2') {
      evMl = foundMarketDef.esito === '1' ? preds[foundMarketDef.stat].casa : foundMarketDef.esito === '2' ? preds[foundMarketDef.stat].ospite : (preds[foundMarketDef.stat].casa + preds[foundMarketDef.stat].ospite) / 2;
    }

    if (evMl === null) continue;

    let sd = null;
    let probability = null;

    if (foundMarketDef.type === 'over_under') {
      if (foundMarketDef.scope === 'casa' || foundMarketDef.scope === 'ospite') {
        sd = SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, foundMarketDef.scope, pastMatches);
      } else {
        const sdCasa = SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'casa', pastMatches);
        const sdOspite = SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'ospite', pastMatches);
        sd = Math.sqrt(sdCasa ** 2 + sdOspite ** 2);
      }
      probability = PROB_BINOM_NEG(foundMarketDef.line, evMl, sd, foundMarketDef.direction);
    } else if (foundMarketDef.type === '1x2') {
       const sdCasa = SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'casa', pastMatches);
       const sdOspite = SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'ospite', pastMatches);
       sd = foundMarketDef.esito === '1' ? sdCasa : foundMarketDef.esito === '2' ? sdOspite : Math.sqrt((sdCasa ** 2 + sdOspite ** 2) / 2);
       // Wait, PROB_1X2_IBRIDO takes 5 args for 1X2!
       const evCasaMl = preds[foundMarketDef.stat].casa;
       const evOspiteMl = preds[foundMarketDef.stat].ospite;
       probability = PROB_1X2_IBRIDO(evCasaMl, sdCasa, evOspiteMl, sdOspite, foundMarketDef.esito);
    }

    if (probability !== null) {
      const bestOdds = Math.max(b.sportium || 0, b.sportbet || 0);
      const edge = bestOdds > 0 ? (bestOdds * probability) - 1 : 0;

      updates.push({
        sql: "UPDATE backtest_bets SET probability = ?, best_edge = ?, ev_ml = ? WHERE id = ?",
        args: [probability, edge, evMl, b.id]
      });
    }
  }

  console.log(`4/5 Updating ${updates.length} rows in the database...`);
  
  const BATCH_SIZE = 100;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    await db.batch(updates.slice(i, i + BATCH_SIZE));
  }

  console.log("5/5 Done!");
}

start().catch(console.error);
