import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import { execFile } from 'child_process';

// Helpers per ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Importazioni dei moduli del progetto (ESM)
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from './lib/engine.js';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO, PROB_BINOM_NEG_ML, PROB_1X2_IBRIDO_ML } from './lib/probability.js';
import { INDICE_ARBITRO_AVANZATO } from './lib/referee.js';
import { getAllMarkets, generateCustomMarket } from './lib/markets.js';

const baseMarkets = getAllMarkets();

// Caricamento variabili d'ambiente manuale per script standalone
let env = {};
try {
  const envData = fs.readFileSync('.env.local', 'utf8');
  env = envData.split('\n').reduce((acc, line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
    return acc;
  }, {});
} catch (e) {
  console.warn("Avviso: .env.local non trovato, uso default.");
}

async function start() {
  const db = createClient({ 
    url: env.TURSO_DATABASE_URL || 'file:resoconto.db', 
    authToken: env.TURSO_AUTH_TOKEN 
  });

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
      
      let referee = null;
      const m = allMatches.find(m => m.home_team === home && m.away_team === away);
      if (m) referee = m.referee;

      uniqueMatchesMap.set(b.match_key, { home, away, referee: referee || '' });
    }
  }

  const uniqueMatches = Array.from(uniqueMatchesMap.values());
  console.log(`2/5 Running ML Predictions for ${uniqueMatches.length} unique matches (Level 3)...`);

  // Write batch file
  const batchFilePath = path.join(__dirname, `temp_batch_ml_${Date.now()}.json`);
  fs.writeFileSync(batchFilePath, JSON.stringify(uniqueMatches));

  const mlPredictions = await new Promise((resolve, reject) => {
    // Usa l'eseguibile Python 3.13 per supportare i pacchetti ML installati
    const pythonExec = 'python3';
    execFile(pythonExec, ['ml_predict.py', '--batch-file', batchFilePath], { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error("Invalid ML output: " + stdout.substring(0, 200)));
      }
    });
  });

  if (fs.existsSync(batchFilePath)) {
    fs.unlinkSync(batchFilePath);
  }

  // Map predictions back to matchKey
  const mlPredsByKey = {};
  const uniqueKeys = Array.from(uniqueMatchesMap.keys());
  for (let i = 0; i < uniqueKeys.length; i++) {
    mlPredsByKey[uniqueKeys[i]] = mlPredictions[i];
  }

  console.log("3/5 Recalculating Probabilities and Edges with Dynamic Variance...");

  const updates = [];

  for (const b of bets) {
    const [league, homeTeam, awayTeam] = b.match_key.split('|');
    const preds = mlPredsByKey[b.match_key];

    if (!preds) continue;

    // Past matches per SD (se necessario fallback)
    const pastMatches = allMatches.filter(m => m.date < b.match_date && m.league === league);

    // Ricostruisci marketDef
    let foundMarketDef = null;
    if (b.is_custom === 1) {
      foundMarketDef = generateCustomMarket(b.custom_stat, b.custom_type, b.custom_scope, b.custom_direction, b.custom_line, b.custom_esito);
    } else {
      for (const m of baseMarkets) {
        const generatedName = typeof m.format === 'function' ? m.format(homeTeam, awayTeam) : m.name;
        if (generatedName === b.bet_name) {
          foundMarketDef = m;
          break;
        }
      }
    }

    if (!foundMarketDef) continue;

    // Calcolo EV e Varianza ML
    let evMl = null;
    let varMl = null;
    let probMl = null;

    const scope = foundMarketDef.scope === 'casa' ? 'casa' : foundMarketDef.scope === 'ospite' ? 'ospite' : null;
    
    if (scope) {
      evMl = preds[foundMarketDef.stat][scope];
      varMl = preds[foundMarketDef.stat][`${scope}_var`] || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, scope, pastMatches), 2);
    } else if (foundMarketDef.type === 'over_under') {
      evMl = Math.round((preds[foundMarketDef.stat].casa + preds[foundMarketDef.stat].ospite) * 100) / 100;
      const vCasa = preds[foundMarketDef.stat].casa_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'casa', pastMatches), 2);
      const vOspite = preds[foundMarketDef.stat].ospite_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'ospite', pastMatches), 2);
      varMl = vCasa + vOspite;
    } else if (foundMarketDef.type === '1x2') {
       // 1x2 usa le varianze separate
       const evCasa = preds[foundMarketDef.stat].casa;
       const evOspite = preds[foundMarketDef.stat].ospite;
       const vCasa = preds[foundMarketDef.stat].casa_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'casa', pastMatches), 2);
       const vOspite = preds[foundMarketDef.stat].ospite_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'ospite', pastMatches), 2);
       
       probMl = PROB_1X2_IBRIDO_ML(evCasa, vCasa, evOspite, vOspite, foundMarketDef.esito);
       evMl = foundMarketDef.esito === '1' ? evCasa : foundMarketDef.esito === '2' ? evOspite : (evCasa + evOspite) / 2;
    }

    if (evMl !== null) {
      // Calcolo del CV
      let cvMl = 0;
      if (foundMarketDef.type === 'over_under' && varMl !== null) {
        probMl = PROB_BINOM_NEG_ML(foundMarketDef.line, evMl, varMl, foundMarketDef.direction);
        cvMl = CV_CALC(evMl, Math.sqrt(varMl));
      } else if (foundMarketDef.type === '1x2') {
        const evCasa = preds[foundMarketDef.stat].casa;
        const evOspite = preds[foundMarketDef.stat].ospite;
        const vCasa = preds[foundMarketDef.stat].casa_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'casa', pastMatches), 2);
        const vOspite = preds[foundMarketDef.stat].ospite_var || Math.pow(SD_AVANZATO(homeTeam, awayTeam, foundMarketDef.stat, 'ospite', pastMatches), 2);
        
        let targetVar = foundMarketDef.esito === '1' ? vCasa : foundMarketDef.esito === '2' ? vOspite : ((vCasa + vOspite) / 2);
        cvMl = CV_CALC(evMl, Math.sqrt(targetVar));
      } else if (varMl !== null) {
        cvMl = CV_CALC(evMl, Math.sqrt(varMl));
      }

      if (probMl !== null) {
        const bestOdds = Math.max(b.sportium || 0, b.sportbet || 0);
        const edge = bestOdds > 0 ? (bestOdds * probMl) - 1 : 0;

        updates.push({
          sql: "UPDATE backtest_bets SET probability = ?, best_edge = ?, ev_ml = ?, cv = ? WHERE id = ?",
          args: [probMl, edge, evMl, cvMl, b.id]
        });
      }
    }
  }

  console.log(`4/5 Updating ${updates.length} rows in the database...`);
  
  const BATCH_SIZE = 100;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    await db.batch(updates.slice(i, i + BATCH_SIZE));
  }

  console.log("5/5 Done!");
  process.exit(0);
}

start().catch(err => {
  console.error("ERRORE SCRIPT:");
  console.error(err);
  if (err.stdout) {
    console.error("STDOUT PYTHON:");
    console.error(err.stdout.toString());
  }
  process.exit(1);
});
