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
  
  const countRes = await db.execute('SELECT COUNT(*) as cnt FROM matches');
  console.log('Total matches:', countRes.rows[0].cnt);
  
  const leagueRes = await db.execute('SELECT league, COUNT(*) as cnt, MIN(date) as min_date, MAX(date) as max_date FROM matches GROUP BY league');
  console.log('\nMatches by league:');
  leagueRes.rows.forEach(r => {
    console.log(`  ${r.league}: ${r.cnt} matches (from ${r.min_date} to ${r.max_date})`);
  });

  const nullXgRes = await db.execute('SELECT COUNT(*) as cnt FROM matches WHERE home_xg IS NULL');
  console.log('\nMatches with NULL home_xg:', nullXgRes.rows[0].cnt);

  const passesRes = await db.execute('SELECT COUNT(*) as cnt FROM matches WHERE home_passes IS NOT NULL');
  console.log('Matches with non-NULL passes:', passesRes.rows[0].cnt);
}

run().catch(console.error);
