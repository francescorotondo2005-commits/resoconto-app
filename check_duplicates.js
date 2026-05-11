import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function checkDuplicates() {
  const res = await db.execute("SELECT id, match_key, bet_name FROM backtest_bets");
  const rows = res.rows;
  
  const ids = new Set();
  const combos = new Set();
  let duplicateIds = 0;
  let duplicateCombos = 0;

  for (const r of rows) {
    if (ids.has(r.id)) duplicateIds++;
    ids.add(r.id);

    const combo = `${r.match_key}|${r.bet_name}`;
    if (combos.has(combo)) duplicateCombos++;
    combos.add(combo);
  }

  console.log('--- VERIFICA DUPLICATI ---');
  console.log('Righe totali:', rows.length);
  console.log('ID duplicati (dovrebbe essere 0):', duplicateIds);
  console.log('Scommesse identiche (stesso match e tipo):', duplicateCombos);
  console.log('Scommesse UNICHE (senza doppioni):', rows.length - duplicateCombos);
  
  process.exit(0);
}

checkDuplicates().catch(console.error);
