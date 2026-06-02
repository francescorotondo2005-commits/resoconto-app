import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

function getDb() {
  const envPath = path.join(process.cwd(), '.env.local');
  let url = 'file:resoconto.db';
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

async function runMigration() {
  const db = getDb();
  console.log('Starting DB migration to fix Angers/Rangers collision...');
  
  try {
    // 1. Aggiorna matches
    console.log('Updating matches home_team...');
    const resHome = await db.execute({
      sql: "UPDATE matches SET home_team = 'Rangers' WHERE home_team = 'Angers' AND league NOT IN ('Ligue1', 'CoupeDeFrance')"
    });
    console.log(`Updated ${resHome.rowsAffected} home_team rows.`);

    console.log('Updating matches away_team...');
    const resAway = await db.execute({
      sql: "UPDATE matches SET away_team = 'Rangers' WHERE away_team = 'Angers' AND league NOT IN ('Ligue1', 'CoupeDeFrance')"
    });
    console.log(`Updated ${resAway.rowsAffected} away_team rows.`);

    // 2. Aggiorna teams
    console.log('Fetching teams to clean up...');
    const teamsRes = await db.execute({
      sql: "SELECT id, league FROM teams WHERE name = 'Angers' AND league NOT IN ('Ligue1', 'CoupeDeFrance')"
    });
    
    console.log(`Found ${teamsRes.rows.length} duplicate Angers teams in non-French leagues.`);
    
    for (const t of teamsRes.rows) {
      // Controlla se 'Rangers' esiste già in quella lega
      const existsRes = await db.execute({
        sql: "SELECT id FROM teams WHERE name = 'Rangers' AND league = ?",
        args: [t.league]
      });
      
      if (existsRes.rows.length > 0) {
        console.log(`Rangers already exists in ${t.league}. Deleting Angers team record...`);
        await db.execute({
          sql: "DELETE FROM teams WHERE id = ?",
          args: [t.id]
        });
      } else {
        console.log(`Renaming Angers to Rangers in ${t.league}...`);
        await db.execute({
          sql: "UPDATE teams SET name = 'Rangers' WHERE id = ?",
          args: [t.id]
        });
      }
    }
    
    console.log('MIGRATION SUCCESSFULLY COMPLETED!');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

runMigration();
