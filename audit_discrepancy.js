
import { createClient } from '@libsql/client';

const TURSO_DATABASE_URL = "https://resoconto-db-francescorotondo2005-commits.aws-eu-west-1.turso.io";
const TURSO_AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUwNTUxMjQsImlkIjoiMDE5ZDQ5ODMtOTcwMS03OWM0LTk2OTQtMWVhYmE2OGFkNzZmIiwicmlkIjoiMmIxZjkwNmMtNDM0MS00OTliLWFmZTktZDhkMTk4OTI5MjM1In0.GDyi7O2eN20V0HBGMhWqckt_aWDmdP_Qbsb2rkwi-X2l3_bwXTFUy9gI9OGUjLs799SnTq0S4IaH_Rg3lR3TDg";

async function audit() {
  const db = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });

  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const rawBets = res.rows;
  console.log(`Totale scommesse WIN/LOSS nel DB: ${rawBets.length}`);

  // Parametri del tuo screenshot
  const minEdge = 0;
  const minProb = 0.50;
  const minQuota = 1.60;
  const minHistAvg = 0.68;
  const minFormAvg = 0.80;
  const eps = 0.0001;

  let dashboardCount = 0;
  let gridCount = 0;

  for (const b of rawBets) {
    const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
    const prob = b.probability || 0;
    const edge = b.best_edge || 0;
    const histScore = b.hist_score;

    // Calcolo Form Score (Logica Dashboard)
    const fParts = [];
    if (b.form_home_pct !== null) fParts.push(b.form_home_pct);
    if (b.form_away_pct !== null) fParts.push(b.form_away_pct);
    if (b.form_home_gen_pct !== null) fParts.push(b.form_home_gen_pct);
    if (b.form_away_gen_pct !== null) fParts.push(b.form_away_gen_pct);
    const formScore = fParts.length > 0 ? fParts.reduce((a,v) => a+v, 0) / fParts.length : null;

    // Logica DASHBOARD (con Epsilon)
    let dPass = true;
    if (edge < (minEdge - eps)) dPass = false;
    if (prob < (minProb - eps)) dPass = false;
    if (maxOdds < (minQuota - eps)) dPass = false;
    if (minFormAvg > 0 && (formScore === null || formScore < (minFormAvg - eps))) dPass = false;
    if (minHistAvg > 0 && (histScore === null || histScore < (minHistAvg - eps))) dPass = false;

    if (dPass) dashboardCount++;

    // Logica GRID SEARCH (attuale con Epsilon)
    let gPass = true;
    if (edge < (minEdge - eps)) gPass = false;
    if (prob < (minProb - eps)) gPass = false;
    if (maxOdds < (minQuota - eps)) gPass = false;
    
    // Nello script la logica è: b.histScore !== null && b.histScore >= (minHistAvg - eps)
    if (histScore === null || histScore < (minHistAvg - eps)) gPass = false;
    if (formScore === null || formScore < (minFormAvg - eps)) gPass = false;

    if (gPass) gridCount++;

    if (dPass && !gPass) {
        console.log(`\n--- DISCREPANZA TROVATA ---`);
        console.log(`Match: ${b.match_key}`);
        console.log(`HistScore: ${histScore}, FormScore: ${formScore}`);
        console.log(`Motivo: ${histScore === null ? 'Hist NULL' : (histScore < (minHistAvg - eps) ? 'Hist LOW' : 'Other')}`);
    }
  }

  console.log(`\nRisultato Audit:`);
  console.log(`Dashboard Count: ${dashboardCount}`);
  console.log(`Grid Count: ${gridCount}`);
  process.exit(0);
}

audit();
