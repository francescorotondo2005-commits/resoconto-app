import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function listTeams() {
  const res = await db.execute(`
    SELECT DISTINCT home_team FROM matches WHERE home_xg IS NULL
    UNION
    SELECT DISTINCT away_team FROM matches WHERE home_xg IS NULL
  `);
  
  const teams = res.rows.map(r => Object.values(r)[0]).sort();
  
  const targetTeams = ['Ein Frankfurt', 'Lilla', 'Espanol', 'Maiorca', 'Cadice', 'Lazio', 'Roma', 'Inter', 'Barcellona'];
  
  const found = teams.filter(t => targetTeams.includes(t));
  console.log("Target teams found with missing xG:", found);
  process.exit(0);
}

listTeams().catch(console.error);
