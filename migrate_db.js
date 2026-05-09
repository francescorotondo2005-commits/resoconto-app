const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./resoconto.db');

db.serialize(() => {
  // Aggiungi colonna ev_ml a bets
  db.run("ALTER TABLE bets ADD COLUMN ev_ml REAL", (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('Colonna ev_ml già presente in bets.');
      } else {
        console.error('Errore bets:', err);
      }
    } else {
      console.log('Aggiunta colonna ev_ml a bets.');
    }
  });

  // Aggiungi colonna ev_ml a backtest_bets
  db.run("ALTER TABLE backtest_bets ADD COLUMN ev_ml REAL", (err) => {
    if (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('Colonna ev_ml già presente in backtest_bets.');
      } else {
        console.error('Errore backtest_bets:', err);
      }
    } else {
      console.log('Aggiunta colonna ev_ml a backtest_bets.');
    }
  });
});

db.close();
