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

  console.log("Fixing pending_matches...");
  
  // 1. Update pending_matches home_team and away_team
  await db.execute("UPDATE pending_matches SET home_team = 'Amburgo' WHERE home_team = 'Hamburg'");
  await db.execute("UPDATE pending_matches SET away_team = 'Amburgo' WHERE away_team = 'Hamburg'");
  await db.execute("UPDATE pending_matches SET home_team = 'Friburgo' WHERE home_team = 'Freiburg'");
  await db.execute("UPDATE pending_matches SET away_team = 'Friburgo' WHERE away_team = 'Freiburg'");

  // 2. Update match_key in pending_matches
  await db.execute("UPDATE pending_matches SET match_key = REPLACE(match_key, 'Hamburg', 'Amburgo') WHERE match_key LIKE '%Hamburg%'");
  await db.execute("UPDATE pending_matches SET match_key = REPLACE(match_key, 'Freiburg', 'Friburgo') WHERE match_key LIKE '%Freiburg%'");

  console.log("Fixing match_odds...");
  // 3. Update match_odds match_key
  await db.execute("UPDATE match_odds SET match_key = REPLACE(match_key, 'Hamburg', 'Amburgo') WHERE match_key LIKE '%Hamburg%'");
  await db.execute("UPDATE match_odds SET match_key = REPLACE(match_key, 'Freiburg', 'Friburgo') WHERE match_key LIKE '%Freiburg%'");

  console.log("Fixing backtest_bets...");
  // 4. Update backtest_bets match_key
  await db.execute("UPDATE backtest_bets SET match_key = REPLACE(match_key, 'Hamburg', 'Amburgo') WHERE match_key LIKE '%Hamburg%'");
  await db.execute("UPDATE backtest_bets SET match_key = REPLACE(match_key, 'Freiburg', 'Friburgo') WHERE match_key LIKE '%Freiburg%'");
  
  console.log("Fixing fixtures_cache...");
  await db.execute("UPDATE fixtures_cache SET home_team = 'Amburgo' WHERE home_team = 'Hamburg'");
  await db.execute("UPDATE fixtures_cache SET away_team = 'Amburgo' WHERE away_team = 'Hamburg'");
  await db.execute("UPDATE fixtures_cache SET home_team = 'Friburgo' WHERE home_team = 'Freiburg'");
  await db.execute("UPDATE fixtures_cache SET away_team = 'Friburgo' WHERE away_team = 'Freiburg'");
  
  console.log("All fixes applied to Turso DB!");
}

run().catch(console.error);
