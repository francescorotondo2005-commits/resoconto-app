import Database from 'better-sqlite3';
const db = new Database('resoconto.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name));

const cols = db.prepare('PRAGMA table_info(backtest)').all();
console.log('\nBacktest columns:', cols.map(c => c.name + ' (' + c.type + ')'));

// Sample some data
const sample = db.prepare('SELECT * FROM backtest LIMIT 3').all();
console.log('\nSample data:', JSON.stringify(sample, null, 2));

db.close();
