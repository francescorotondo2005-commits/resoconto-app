import { getDb } from '../lib/db.js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) {
    process.env[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
  }
});

async function run() {
  const db = await getDb();
  
  // 1. Update local matches competition_type if NULL (campionati are 'league')
  console.log("Updating competition_type for local league matches...");
  const updateRes = await db.execute(`
    UPDATE matches 
    SET competition_type = 'league' 
    WHERE competition_type IS NULL 
      AND league IN ('SerieA', 'Premier', 'LaLiga', 'Ligue1', 'Bundes')
  `);
  console.log(`Updated ${updateRes.rowsAffected} league matches.`);

  // 2. Count by competition_type
  const counts = await db.execute(`
    SELECT competition_type, COUNT(*) as cnt 
    FROM matches 
    GROUP BY competition_type
  `);
  console.log("\nMatches by competition_type:");
  counts.rows.forEach(r => {
    console.log(`  ${r.competition_type}: ${r.cnt}`);
  });
}

run().catch(console.error);
