import fs from 'fs';
import { createClient } from '@libsql/client';

let env = {};
try {
  const envData = fs.readFileSync('.env.local', 'utf8');
  env = envData.split('\n').reduce((acc, line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) acc[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
    return acc;
  }, {});
} catch (e) {
  console.warn("Avviso: .env.local non trovato, uso default.");
}

async function migrate() {
  const db = createClient({ 
    url: env.TURSO_DATABASE_URL || 'file:resoconto.db', 
    authToken: env.TURSO_AUTH_TOKEN 
  });

  try {
    await db.execute("ALTER TABLE bets ADD COLUMN cv REAL");
    console.log("Aggiunta colonna cv a bets.");
  } catch (err) {
    if (err.message && err.message.includes("duplicate column name")) {
       console.log("Colonna cv già presente in bets.");
    } else {
       console.error("Errore bets:", err.message);
    }
  }

  try {
    await db.execute("ALTER TABLE backtest_bets ADD COLUMN cv REAL");
    console.log("Aggiunta colonna cv a backtest_bets.");
  } catch (err) {
    if (err.message && err.message.includes("duplicate column name")) {
       console.log("Colonna cv già presente in backtest_bets.");
    } else {
       console.error("Errore backtest_bets:", err.message);
    }
  }
}

migrate();
