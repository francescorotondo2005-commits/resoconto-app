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
  
  // Query all pending matches (excluding the summer qualifiers)
  const res = await db.execute({
    sql: `
      SELECT DISTINCT league, home_team, away_team 
      FROM matches 
      WHERE home_xg IS NULL 
        AND NOT (league IN ('ChampionsLeague', 'EuropaLeague', 'ConferenceLeague') 
                 AND strftime('%m', date) IN ('07', '08'))
      ORDER BY league
    `
  });
  
  console.log(`Total unique pending matches: ${res.rows.length}`);
  
  // Let's analyze and group them by league to spot patterns of foreign/cup teams
  const leagues = {};
  res.rows.forEach(r => {
    if (!leagues[r.league]) leagues[r.league] = [];
    leagues[r.league].push({ home: r.home_team, away: r.away_team });
  });
  
  for (const [league, matches] of Object.entries(leagues)) {
    console.log(`\nLeague: ${league} (${matches.length} pending matches)`);
    // Print a sample or all of them if the league is a cup
    if (['ChampionsLeague', 'EuropaLeague', 'ConferenceLeague'].includes(league)) {
      console.log(`  Sample matches:`);
      matches.forEach(m => {
        console.log(`    - ${m.home} vs ${m.away}`);
      });
    } else {
      console.log(`    (National league/cup - usually matches standard teams)`);
      if (matches.length < 15) {
        matches.forEach(m => console.log(`    - ${m.home} vs ${m.away}`));
      } else {
        console.log(`    - e.g. ${matches[0].home} vs ${matches[0].away}`);
      }
    }
  }
}

run().catch(console.error);
