const fs = require('fs');
const { createClient } = require('@libsql/client');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

async function run() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute(`
    SELECT outcome, probability, sportium, sportbet, best_edge,
           home_hist_pct, away_hist_pct, ref_hist_pct,
           home_hist_sample, away_hist_sample, ref_hist_sample,
           form_home_pct, form_away_pct, form_ref_pct
    FROM backtest_bets 
    WHERE outcome IN ('WIN', 'LOSS') AND best_edge >= 0.28 AND probability >= 0.70
  `);
  const bets = res.rows;
  console.log('Loaded ' + bets.length + ' VALUE bets (Edge >= 28%, Prob >= 70%).');

  function evaluateCombos(weights) {
    const thresholds = [0, 0.50, 0.60, 0.65, 0.70];
    const formThresholds = [0, 0.50, 0.60, 0.70];

    for (const histT of thresholds) {
      for (const formT of formThresholds) {
        if (histT === 0 && formT === 0) continue; // Base case handled separately

        let wins = 0; let total = 0; let profit = 0;
        for (const b of bets) {
          // Hist Score calc
          let customScore = null;
          let hasRef = b.ref_hist_pct !== null && b.ref_hist_sample >= 3;
          let hPct = b.home_hist_pct;
          let aPct = b.away_hist_pct;
          let rPct = b.ref_hist_pct;

          if (!hasRef) {
            const { wH, wA } = weights.withoutRef;
            if (hPct !== null && aPct !== null) customScore = (hPct * wH + aPct * wA) / (wH + wA);
            else if (hPct !== null) customScore = hPct;
            else if (aPct !== null) customScore = aPct;
          } else {
            const { wH, wA, wR } = weights.withRef;
            let parts = []; let totalW = 0;
            if (hPct !== null) { parts.push(hPct * wH); totalW += wH; }
            if (aPct !== null) { parts.push(aPct * wA); totalW += wA; }
            if (rPct !== null) { parts.push(rPct * wR); totalW += wR; }
            if (totalW > 0) customScore = parts.reduce((a,b)=>a+b, 0) / totalW;
          }

          // Form calc
          let formScore = null;
          let hForm = b.form_home_pct;
          let aForm = b.form_away_pct;
          if (hForm !== null && aForm !== null) {
            formScore = (hForm + aForm) / 2;
          }

          let passHist = histT === 0 || (customScore !== null && customScore >= histT);
          let passForm = formT === 0 || (formScore !== null && formScore >= formT);

          if (passHist && passForm) {
            total++;
            if (b.outcome === 'WIN') {
              wins++;
              const odds = Math.max(b.sportium || 1, b.sportbet || 1);
              profit += (odds - 1);
            } else {
              profit -= 1;
            }
          }
        }
        
        let hr = total > 0 ? (wins / total * 100).toFixed(1) + '%' : '0%';
        let y = total > 0 ? (profit / total * 100).toFixed(1) + '%' : '0%';
        console.log(`Hist > ${histT*100}% | Form > ${formT*100}% -> Bets: ${total.toString().padStart(2)} | HR: ${hr.padStart(6)} | Yield: ${y.padStart(6)} | P&L: ${profit.toFixed(2)}`);
      }
    }
  }

  // Base
  let wins=0, total=0, profit=0;
  for (const b of bets) {
    total++;
    if (b.outcome==='WIN') { wins++; profit += Math.max(b.sportium||1, b.sportbet||1)-1; }
    else profit -= 1;
  }
  console.log(`\nBASELINE: Bets: ${total} | HR: ${(wins/total*100).toFixed(1)}% | Yield: ${(profit/total*100).toFixed(1)}% | P&L: ${profit.toFixed(2)}\n`);

  console.log('--- Config: Trasferta Pesa Molto (30-70) ---');
  evaluateCombos({ withoutRef: { wH: 0.30, wA: 0.70 }, withRef: { wH: 0.10, wA: 0.40, wR: 0.50 } });

}
run().catch(console.error);
