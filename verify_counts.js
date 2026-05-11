import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function verifyCounts() {
  const res = await db.execute("SELECT probability, sportium, sportbet FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const rows = res.rows;
  
  let total160 = 0;
  let prob65_160 = 0;
  let prob70_160 = 0;

  for (const r of rows) {
    const odds = Math.max(r.sportium || 0, r.sportbet || 0);
    if (odds >= 1.60) {
      total160++;
      if (r.probability >= 0.65) prob65_160++;
      if (r.probability >= 0.70) prob70_160++;
    }
  }

  console.log('--- VERIFICA COERENZA DATI ---');
  console.log('Scommesse totali con esito e Quota >= 1.60:', total160);
  console.log('Scommesse con Quota >= 1.60 E Probabilità >= 65%:', prob65_160);
  console.log('Scommesse con Quota >= 1.60 E Probabilità >= 70%:', prob70_160);
  
  process.exit(0);
}

verifyCounts().catch(console.error);
