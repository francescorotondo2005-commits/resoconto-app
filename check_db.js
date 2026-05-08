const { createClient } = require('@libsql/client');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

async function dump() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute('SELECT bet_name FROM backtest_bets LIMIT 20');
  console.log(JSON.stringify(res.rows, null, 2));
}

dump().catch(console.error);
