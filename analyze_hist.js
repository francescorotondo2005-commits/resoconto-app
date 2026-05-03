const { createClient } = require('@libsql/client');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log('Fetching backtest bets...');
  const res = await db.execute(`
    SELECT outcome, probability, sportium, sportbet, best_edge,
           home_hist_pct, away_hist_pct, ref_hist_pct,
           home_hist_sample, away_hist_sample, ref_hist_sample,
           form_home_pct, form_away_pct, form_ref_pct
    FROM backtest_bets 
    WHERE outcome IN ('WIN', 'LOSS')
  `);

  const bets = res.rows;
  console.log(`Loaded ${bets.length} completed bets.`);

  // Evaluate different weighting schemes
  // We want to calculate a custom hist_score based on different weights.
  // Then we check the Hit Rate and Yield for bets that pass a certain threshold of this custom score.

  function evaluate(weights, minScore) {
    let wins = 0;
    let total = 0;
    let profit = 0;

    for (const b of bets) {
      // Basic filter: only consider bets with Edge > 20% to avoid garbage
      if (b.best_edge < 0.20) continue;

      let customScore = null;
      let hasRef = b.ref_hist_pct !== null && b.ref_hist_sample >= 3;
      let hPct = b.home_hist_pct;
      let aPct = b.away_hist_pct;
      let rPct = b.ref_hist_pct;

      if (hPct === null && aPct === null) continue;

      if (!hasRef) {
        if (hPct !== null && aPct !== null) {
          customScore = hPct * 0.5 + aPct * 0.5;
        } else if (hPct !== null) customScore = hPct;
        else if (aPct !== null) customScore = aPct;
      } else {
        const { wH, wA, wR } = weights.withRef;
        let parts = [];
        let totalW = 0;
        if (hPct !== null) { parts.push(hPct * wH); totalW += wH; }
        if (aPct !== null) { parts.push(aPct * wA); totalW += wA; }
        if (rPct !== null) { parts.push(rPct * wR); totalW += wR; }
        if (totalW > 0) {
          customScore = parts.reduce((a,b)=>a+b, 0) / totalW;
        }
      }

      if (customScore !== null && customScore >= minScore) {
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

    return {
      total,
      hitRate: total > 0 ? (wins / total * 100).toFixed(1) + '%' : '0%',
      yield: total > 0 ? (profit / total * 100).toFixed(1) + '%' : '0%',
      profit: profit.toFixed(2)
    };
  }

  const thresholds = [0.50, 0.55, 0.60, 0.65, 0.70];
  const weightConfigs = [
    { name: "Attuale (25-25-50)", withRef: { wH: 0.25, wA: 0.25, wR: 0.50 } },
    { name: "Equilibrato (33-33-33)", withRef: { wH: 0.33, wA: 0.33, wR: 0.34 } },
    { name: "Team Focus (40-40-20)", withRef: { wH: 0.40, wA: 0.40, wR: 0.20 } },
    { name: "Ref Focus (15-15-70)", withRef: { wH: 0.15, wA: 0.15, wR: 0.70 } },
  ];

  console.log('\\n--- ANALISI PESI ARBITRO ---');
  for (const w of weightConfigs) {
    console.log(`\\nConfig: ${w.name}`);
    for (const t of thresholds) {
      const res = evaluate(w, t);
      console.log(`  Soglia > ${(t*100)}%: Bets: ${res.total.toString().padStart(3)} | HR: ${res.hitRate.padStart(6)} | Yield: ${res.yield.padStart(6)} | P&L: ${res.profit}`);
    }
  }

  // Next: analyze form correlation
  console.log('\\n--- ANALISI STATO DI FORMA (Ultime 5) ---');
  
  function evaluateForm(minFormScore) {
    let wins = 0;
    let total = 0;
    let profit = 0;

    for (const b of bets) {
      if (b.best_edge < 0.20) continue;
      
      let hForm = b.form_home_pct;
      let aForm = b.form_away_pct;
      if (hForm === null || aForm === null) continue;
      
      let formScore = (hForm + aForm) / 2;
      
      if (formScore >= minFormScore) {
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
    return {
      total,
      hitRate: total > 0 ? (wins / total * 100).toFixed(1) + '%' : '0%',
      yield: total > 0 ? (profit / total * 100).toFixed(1) + '%' : '0%',
      profit: profit.toFixed(2)
    };
  }

  const formThresholds = [0.40, 0.50, 0.60, 0.80];
  for (const t of formThresholds) {
    const res = evaluateForm(t);
    console.log(`  Form > ${(t*100)}%: Bets: ${res.total.toString().padStart(3)} | HR: ${res.hitRate.padStart(6)} | Yield: ${res.yield.padStart(6)} | P&L: ${res.profit}`);
  }
}

run().catch(console.error);
