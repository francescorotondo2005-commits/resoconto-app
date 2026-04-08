import { createClient } from '@libsql/client';
import path from 'path';

let db = null;

export async function getDb() {
  if (db) return db;
  
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'resoconto.db');
  
  const url = process.env.TURSO_DATABASE_URL || `file:${dbPath}`;
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

  db = createClient({
    url,
    authToken,
  });
  
  // Initialize schema
  await initSchema(db);
  
  return db;
}

async function initSchema(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league TEXT NOT NULL,
      matchday INTEGER,
      date TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_goals INTEGER NOT NULL,
      away_goals INTEGER NOT NULL,
      home_shots INTEGER NOT NULL,
      away_shots INTEGER NOT NULL,
      home_sot INTEGER NOT NULL,
      away_sot INTEGER NOT NULL,
      home_fouls INTEGER NOT NULL,
      away_fouls INTEGER NOT NULL,
      home_corners INTEGER NOT NULL,
      away_corners INTEGER NOT NULL,
      home_yellows INTEGER NOT NULL,
      away_yellows INTEGER NOT NULL,
      home_reds INTEGER NOT NULL,
      away_reds INTEGER NOT NULL,
      home_saves INTEGER,
      away_saves INTEGER,
      referee TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      league TEXT NOT NULL,
      match_description TEXT NOT NULL,
      bet_name TEXT NOT NULL,
      bet_category TEXT,
      ev REAL NOT NULL,
      sd REAL NOT NULL,
      cv REAL NOT NULL,
      probability REAL NOT NULL,
      fair_odds REAL NOT NULL,
      min_odds REAL NOT NULL,
      actual_odds REAL NOT NULL,
      bookmaker TEXT NOT NULL,
      edge REAL NOT NULL,
      stake REAL,
      stake_kelly REAL,
      outcome TEXT DEFAULT 'PENDING',
      profit REAL,
      referee_rating REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(league, name)
    );

    CREATE TABLE IF NOT EXISTS fixtures_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league TEXT NOT NULL,
      date TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      kick_off TEXT,
      api_fixture_id INTEGER,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league);
    CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(home_team, away_team);
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_bets_date ON bets(date);
    CREATE INDEX IF NOT EXISTS idx_bets_league ON bets(league);
    CREATE TABLE IF NOT EXISTS match_odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT NOT NULL,
      market_name TEXT NOT NULL,
      sportium REAL,
      sportbet REAL,
      is_custom INTEGER DEFAULT 0,
      custom_stat TEXT,
      custom_type TEXT,
      custom_scope TEXT,
      custom_direction TEXT,
      custom_line REAL,
      custom_esito TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_key, market_name)
    );

    CREATE TABLE IF NOT EXISTS backtest_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT NOT NULL,
      match_date TEXT NOT NULL,
      bet_name TEXT NOT NULL,
      bet_category TEXT,
      probability REAL NOT NULL,
      sportium REAL,
      sportbet REAL,
      best_edge REAL NOT NULL,
      outcome TEXT DEFAULT 'PENDING',
      is_custom INTEGER DEFAULT 0,
      custom_stat TEXT,
      custom_type TEXT,
      custom_scope TEXT,
      custom_direction TEXT,
      custom_line REAL,
      custom_esito TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pending_matches (
      match_key TEXT PRIMARY KEY,
      league TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      referee TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures_cache(date);
    CREATE INDEX IF NOT EXISTS idx_match_odds_key ON match_odds(match_key);
    CREATE INDEX IF NOT EXISTS idx_backtest_match ON backtest_bets(match_key);
  `);

  // Insert default settings if not exist
  const defaults = {
    min_probability: '0.65',
    min_edge: '0.20',
    max_probability: '0.85',
    bankroll: '100',
    stake_mode: 'flat',
    flat_stake: '1',
  };

  const stmts = [];
  for (const [key, value] of Object.entries(defaults)) {
    stmts.push({
      sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      args: [key, String(value)]
    });
  }
  
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

export async function getSetting(key) {
  const db = await getDb();
  const res = await db.execute({
    sql: 'SELECT value FROM settings WHERE key = ?',
    args: [key]
  });
  return res.rows.length > 0 ? res.rows[0].value : null;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.execute({
    sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    args: [key, String(value)]
  });
}
