import fs from 'fs';
import { createClient } from '@libsql/client';

const envData = fs.readFileSync('.env.local', 'utf8');
const env = envData.split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function check() {
  const res = await db.execute('SELECT COUNT(*) as count FROM matches');
  const last = await db.execute('SELECT * FROM matches ORDER BY id DESC LIMIT 1');
  console.log('--- DATABASE STATUS ---');
  console.log('Totale match nel DB:', res.rows[0].count);
  console.log('Ultimo match ID:', last.rows[0].id);
  console.log('Lega:', last.rows[0].league);
  console.log('Data:', last.rows[0].date);
  console.log('Squadre:', last.rows[0].home_team, 'vs', last.rows[0].away_team);
  console.log('Risultato:', last.rows[0].home_goals, '-', last.rows[0].away_goals);
  console.log('Tiri:', last.rows[0].home_shots, '-', last.rows[0].away_shots);
  console.log('Arbitro:', last.rows[0].referee);
  process.exit(0);
}

check().catch(console.error);
