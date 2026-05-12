
import { createClient } from '@libsql/client';

const TURSO_DATABASE_URL = "https://resoconto-db-francescorotondo2005-commits.aws-eu-west-1.turso.io";
const TURSO_AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUwNTUxMjQsImlkIjoiMDE5ZDQ5ODMtOTcwMS03OWM0LTk2OTQtMWVhYmE2OGFkNzZmIiwicmlkIjoiMmIxZjkwNmMtNDM0MS00OTliLWFmZTktZDhkMTk4OTI5MjM1In0.GDyi7O2eN20V0HBGMhWqckt_aWDmdP_Qbsb2rkwi-X2l3_bwXTFUy9gI9OGUjLs799SnTq0S4IaH_Rg3lR3TDg";

async function audit() {
  const db = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
  
  // 1. Simulo esattamente quello che scarica la Dashboard dall'API
  const res = await db.execute("SELECT * FROM backtest_bets ORDER BY created_at DESC LIMIT 10000");
  const allBets = res.rows;

  // Parametri Dashboard (Screenshot)
  const minEdge = 0;
  const minProb = 0.50;
  const minQuota = 1.60;
  const minHistAvg = 0.68;
  const minFormAvg = 0.80;
  const eps = 0.0001;

  const dashboardList = allBets.filter(b => {
    // Filtro esito (solo WIN/LOSS come abbiamo sincronizzato prima)
    if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') return false;

    const edge = b.best_edge ?? 0;
    const prob = b.probability ?? 0;
    const odds = Math.max(b.sportium || 0, b.sportbet || 0);

    if (edge < (minEdge - eps)) return false;
    if (prob < (minProb - eps)) return false;
    if (odds < (minQuota - eps)) return false;

    // Filtri avanzati
    const fParts = [b.form_home_pct, b.form_away_pct, b.form_home_gen_pct, b.form_away_gen_pct].filter(v => v !== null);
    const formScore = fParts.length > 0 ? fParts.reduce((a,v) => a+v, 0) / fParts.length : null;
    if (minFormAvg > 0 && (formScore === null || formScore < (minFormAvg - eps))) return false;

    const histScore = b.hist_score;
    if (minHistAvg > 0 && (histScore === null || histScore < (minHistAvg - eps))) return false;

    return true;
  });

  console.log(`Dashboard vede: ${dashboardList.length} scommesse`);

  // 2. Simulo esattamente quello che vede lo Script delle Combinazioni
  const resGrid = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const gridBets = resGrid.rows;
  
  const gridList = gridBets.filter(b => {
    const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
    if (maxOdds < (minQuota - eps)) return false;
    if (b.probability < (minProb - eps)) return false;
    if (b.best_edge < (minEdge - eps)) return false;

    const fParts = [b.form_home_pct, b.form_away_pct, b.form_home_gen_pct, b.form_away_gen_pct].filter(v => v !== null);
    const formScore = fParts.length > 0 ? fParts.reduce((a,v) => a+v, 0) / fParts.length : null;
    if (minFormAvg > 0 && (formScore === null || formScore < (minFormAvg - eps))) return false;

    const histScore = b.hist_score;
    if (minHistAvg > 0 && (histScore === null || histScore < (minHistAvg - eps))) return false;

    return true;
  });

  console.log(`Script vede: ${gridList.length} scommesse`);

  if (dashboardList.length !== gridList.length) {
    console.log(`\n--- DISCREPANZA RILEVATA ---`);
    dashboardList.forEach(dbet => {
        const found = gridList.find(gbet => gbet.id === dbet.id);
        if (!found) {
            console.log(`Match extra in Dashboard: ${dbet.match_key} | ${dbet.bet_name} (ID: ${dbet.id})`);
            console.log(`Dati: Edge: ${dbet.best_edge}, Prob: ${dbet.probability}, Odds: ${Math.max(dbet.sportium, dbet.sportbet)}, Hist: ${dbet.hist_score}`);
        }
    });
  }

  process.exit(0);
}
audit();
