import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'resoconto.db');

function getDbClient() {
  const envPath = path.join(process.cwd(), '.env.local');
  let url = `file:${DB_PATH}`;
  let authToken = undefined;
  if (fs.existsSync(envPath)) {
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      if (line.includes('=')) {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/"/g, '').replace(/\r/g, '');
      }
    }
    if (env.TURSO_DATABASE_URL) {
      url = env.TURSO_DATABASE_URL;
      authToken = env.TURSO_AUTH_TOKEN;
    }
  }
  return createClient({ url, authToken });
}

async function run() {
  const db = getDbClient();
  const res = await db.execute({
    sql: `SELECT id, league, date, home_team, away_team, home_goals, away_goals FROM matches WHERE date LIKE '2025-05-14%'`
  });
  console.log(`Matches on 2025-05-14 in DB:`);
  res.rows.forEach(r => {
    console.log(`  ID: ${r.id} | ${r.league} | "${r.home_team}" vs "${r.away_team}" | Goals: ${r.home_goals}-${r.away_goals}`);
  });
  
  // Let's also check if there are other matches involving Bologna and Milan near this date
  const res2 = await db.execute({
    sql: `SELECT id, league, date, home_team, away_team, home_goals, away_goals FROM matches WHERE (home_team = 'Milan' OR away_team = 'Milan') AND date LIKE '2025-05%'`
  });
  console.log(`\nMatches involving Milan in May 2025:`);
  res2.rows.forEach(r => {
    console.log(`  ID: ${r.id} | ${r.league} | "${r.home_team}" vs "${r.away_team}" | Date: ${r.date}`);
  });
}

run().catch(console.error);
