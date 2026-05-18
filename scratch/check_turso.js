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

  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS') LIMIT 5");
  console.log("Sample from Turso:");
  console.log(res.rows);
  
  const countRes = await db.execute("SELECT COUNT(*) as cnt FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  console.log("Total completed bets:", countRes.rows[0].cnt);
}

run().catch(console.error);
