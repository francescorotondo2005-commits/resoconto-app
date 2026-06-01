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
  
  const suspiciousItalianNames = [
    'marsiglia', 'nizza', 'lione', 'stella rossa', 'siviglia',
    'saragozza', 'san gallo', 'basilea', 'anversa', 'copenaghen',
    'malmoe', 'goteborg', 'salisburgo', 'austria vienna', 'zagabria',
    'spalato', 'belgrado', 'mosca', 'kiev', 'atene', 'salonicco'
  ];

  const foundSuspicious = teams.filter(t => 
    suspiciousItalianNames.some(sin => t.toLowerCase().includes(sin))
  );

  console.log("Suspicious Italianized team names in DB:", foundSuspicious);
  process.exit(0);
}

listTeams().catch(console.error);
