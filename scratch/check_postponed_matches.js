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
  
  // List of problematic teams
  const teams = [
    'Ejea', 'Hércules', 'Xerez', 'AD Ceuta', 
    'Barbastro', 'Amorebieta', 'Tudelano', 'Deportiva Minera',
    'Don Benito', 'FC Andorra', 'Llanera', 'Cultural Leonesa',
    'Ibiza Islas Pitiusas', 'Gimnastic', 'Langreo', 'Orihuela',
    'Bergantiños', 'Marbella', 'Beasain', 'FC Cartagena',
    'Móstoles', 'Burgos', 'Numancia', 'Sporting Gijon'
  ];
  
  console.log('--- Postponed Matches in DB ---');
  for (const team of teams) {
    const res = await db.execute({
      sql: `SELECT id, league, date, home_team, away_team, home_xg, home_goals, away_goals FROM matches WHERE (home_team = ? OR away_team = ?)`,
      args: [team, team]
    });
    if (res.rows.length > 0) {
      console.log(`\nTeam: ${team} (${res.rows.length} matches):`);
      res.rows.forEach(r => {
        console.log(`  ID: ${r.id} | ${r.league} | "${r.home_team}" vs "${r.away_team}" | Date: ${r.date} | Goals: ${r.home_goals}-${r.away_goals} | home_xg: ${r.home_xg}`);
      });
    }
  }
}

run().catch(console.error);
