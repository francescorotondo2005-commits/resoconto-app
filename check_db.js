import { getDb } from './lib/db.js';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) {
    process.env[key.trim()] = val.join('=').trim().replace(/['"]/g, '');
  }
});

async function checkLatestMatch() {
  const db = await getDb();
  const res = await db.execute('SELECT * FROM matches ORDER BY id DESC LIMIT 1');
  if (res.rows.length > 0) {
    const match = res.rows[0];
    console.log("Latest Match Data:");
    for (const [key, val] of Object.entries(match)) {
      if (val !== null) {
        console.log(`  ${key}: ${val}`);
      } else {
        console.log(`  ${key}: NULL`);
      }
    }
  } else {
    console.log("No matches found in DB.");
  }
}

checkLatestMatch().catch(console.error);
