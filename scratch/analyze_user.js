import { createClient } from '@libsql/client';
import fs from 'fs';

let env = {};
try {
  const envData = fs.readFileSync('.env.local', 'utf8');
  env = envData.split('\n').reduce((acc, line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
    return acc;
  }, {});
} catch (e) {}

async function run() {
  const db = createClient({ 
    url: env.TURSO_DATABASE_URL, 
    authToken: env.TURSO_AUTH_TOKEN 
  });

  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const bets = res.rows;
  
  console.log(`Total completed bets in Turso DB: ${bets.length}`);

  // Step 1: Group bets by match_key and bet_category to extract home/away EV and SD
  const matchStats = {}; 
  // matchStats[match_key][category] = { ev_casa, sd_casa, ev_ospite, sd_ospite }

  for (const b of bets) {
    if (b.ev_ml === null || b.cv === null) continue;
    
    const ev = b.ev_ml;
    const sd = b.ev_ml * b.cv;
    const key = b.match_key;
    const cat = b.bet_category; // e.g., 'Gol', 'Corner', 'Tiri', etc.
    
    if (!matchStats[key]) matchStats[key] = {};
    if (!matchStats[key][cat]) matchStats[key][cat] = { ev_casa: null, sd_casa: null, ev_ospite: null, sd_ospite: null };
    
    const name = b.bet_name.toUpperCase();
    
    if (name.includes('CASA') || name.endsWith(': 1')) {
      matchStats[key][cat].ev_casa = ev;
      matchStats[key][cat].sd_casa = sd;
    } else if (name.includes('OSPITE') || name.endsWith(': 2')) {
      matchStats[key][cat].ev_ospite = ev;
      matchStats[key][cat].sd_ospite = sd;
    }
  }

  // Step 2: Evaluate bets based on user conditions
  let passedBets = [];
  
  for (const b of bets) {
    if (b.ev_ml === null || b.cv === null) continue;
    
    const name = b.bet_name.toUpperCase();
    const ev = b.ev_ml;
    const sd = b.ev_ml * b.cv;
    
    let isUnder = name.startsWith('UNDER');
    let isOver = name.startsWith('OVER');
    let is1 = name.includes('1X2') && name.endsWith(': 1');
    let is2 = name.includes('1X2') && name.endsWith(': 2');
    
    let passed = false;
    
    if (isUnder) {
      // Find the line (e.g., UNDER 3,5 GOL -> 3.5)
      const match = name.match(/UNDER\s+(\d+(?:,\d+)?)/);
      if (match) {
        const line = parseFloat(match[1].replace(',', '.'));
        if (ev + sd < line) {
          passed = true;
        }
      }
    } else if (isOver) {
      const match = name.match(/OVER\s+(\d+(?:,\d+)?)/);
      if (match) {
        const line = parseFloat(match[1].replace(',', '.'));
        if (ev - sd > line) {
          passed = true;
        }
      }
    } else if (is1) {
      const stats = matchStats[b.match_key]?.[b.bet_category];
      if (stats && stats.ev_casa !== null && stats.ev_ospite !== null) {
        if (stats.ev_casa - stats.sd_casa > stats.ev_ospite + stats.sd_ospite) {
          passed = true;
        }
      }
    } else if (is2) {
      const stats = matchStats[b.match_key]?.[b.bet_category];
      if (stats && stats.ev_casa !== null && stats.ev_ospite !== null) {
        if (stats.ev_ospite - stats.sd_ospite > stats.ev_casa + stats.sd_casa) {
          passed = true;
        }
      }
    }
    
    if (passed) {
      passedBets.push(b);
    }
  }

  console.log(`\nCondition: "EV + SD < Linea" (UNDER), "EV - SD > Linea" (OVER), "EV_1 - SD_1 > EV_2 + SD_2" (1), etc.`);
  
  // No odds filter
  const winsAll = passedBets.filter(b => b.outcome === 'WIN').length;
  const totalAll = passedBets.length;
  const winRateAll = totalAll > 0 ? (winsAll / totalAll * 100).toFixed(2) : 0;
  
  console.log(`\n[TUTTE LE SCOMMESSE FILTRATE]`);
  console.log(`Numero di scommesse: ${totalAll}`);
  console.log(`Win Rate: ${winRateAll}% (${winsAll} WIN / ${totalAll} TOTAL)`);
  
  // With min odds >= 1.60
  const passedBetsMin160 = passedBets.filter(b => Math.max(b.sportium || 0, b.sportbet || 0) >= 1.60);
  const wins160 = passedBetsMin160.filter(b => b.outcome === 'WIN').length;
  const total160 = passedBetsMin160.length;
  const winRate160 = total160 > 0 ? (wins160 / total160 * 100).toFixed(2) : 0;
  
  console.log(`\n[SOLO QUOTA >= 1.60]`);
  console.log(`Numero di scommesse: ${total160}`);
  console.log(`Win Rate: ${winRate160}% (${wins160} WIN / ${total160} TOTAL)`);
}

run().catch(console.error);
