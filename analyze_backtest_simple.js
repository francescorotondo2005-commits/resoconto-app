import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function analyzeBacktest() {
  const res = await db.execute("SELECT match_key, match_date FROM backtest_bets");
  const rows = res.rows;
  
  const matches = new Set();
  const leagues = {};
  let minDate = '9999';
  let maxDate = '0000';

  for (const r of rows) {
    matches.add(r.match_key);
    const league = r.match_key.split('|')[0];
    leagues[league] = (leagues[league] || 0) + 1;
    if (r.match_date < minDate) minDate = r.match_date;
    if (r.match_date > maxDate) maxDate = r.match_date;
  }

  console.log('--- ANALISI BACKTEST ---');
  console.log('Partite uniche trovate:', matches.size);
  console.log('Periodo coperto:', minDate, 'al', maxDate);
  console.log('\nDistribuzione per Lega (numero scommesse):');
  Object.entries(leagues).forEach(([l, count]) => {
    console.log(`- ${l}: ${count} scommesse`);
  });
  
  process.exit(0);
}

analyzeBacktest().catch(console.error);
