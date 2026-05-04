const fs = require('fs');
const { createClient } = require('@libsql/client');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

function formatYield(profit, bets) {
  if (bets === 0) return '0.00%';
  return ((profit / bets) * 100).toFixed(2) + '%';
}

function runCombinedAnalysis(bets) {
  console.log('--- TEST COMBINATO: FORMA + STORICO (Filtro Cecchino Elite) ---');
  console.log('Regola: FORMA (Media > 70% & Tutti >= 60%) AND STORICO (Media > 70% & Tutti >= 60%)');
  
  let eliteWins = 0, eliteTotal = 0, eliteProfit = 0;
  
  // Separazione per curiosità statistica
  let noRefWins = 0, noRefTotal = 0, noRefProfit = 0;
  let refWins = 0, refTotal = 0, refProfit = 0;

  for (const b of bets) {
    if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
    const win = b.outcome === 'WIN';
    const profit = win ? b.best_edge : -1;

    // --- Controllo FORMA ---
    let passForm = false;
    if (b.form_home_pct !== null && b.form_away_pct !== null && b.form_home_gen_pct !== null && b.form_away_gen_pct !== null) {
      const mediaForm = (b.form_home_pct + b.form_away_pct + b.form_home_gen_pct + b.form_away_gen_pct) / 4;
      const tuttiForm = b.form_home_pct >= 0.60 && b.form_away_pct >= 0.60 && b.form_home_gen_pct >= 0.60 && b.form_away_gen_pct >= 0.60;
      if (mediaForm > 0.70 && tuttiForm) passForm = true;
    }

    // Se non passa la forma, possiamo già skippare
    if (!passForm) continue;

    // --- Controllo STORICO ---
    let passHist = false;
    const hasRef = b.ref_hist_pct !== null;

    if (hasRef) {
      // CON ARBITRO
      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null && b.ref_hist_pct !== null) {
        const mediaHist = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct + b.ref_hist_pct) / 5;
        const tuttiHist = b.home_hist_pct >= 0.60 && b.away_hist_pct >= 0.60 && b.home_hist_overall_pct >= 0.60 && b.away_hist_overall_pct >= 0.60 && b.ref_hist_pct >= 0.60;
        if (mediaHist > 0.70 && tuttiHist) passHist = true;
      }
    } else {
      // SENZA ARBITRO
      if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null) {
        const mediaHist = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct) / 4;
        const tuttiHist = b.home_hist_pct >= 0.60 && b.away_hist_pct >= 0.60 && b.home_hist_overall_pct >= 0.60 && b.away_hist_overall_pct >= 0.60;
        if (mediaHist > 0.70 && tuttiHist) passHist = true;
      }
    }

    if (passHist) {
      eliteTotal++;
      if (win) eliteWins++;
      eliteProfit += profit;

      if (hasRef) {
        refTotal++;
        if (win) refWins++;
        refProfit += profit;
      } else {
        noRefTotal++;
        if (win) noRefWins++;
        noRefProfit += profit;
      }
    }
  }

  console.log('\n--- RISULTATI ---');
  console.log(`[SOLO SCOMMESSE SENZA ARBITRO] Bets: ${noRefTotal} | WinRate: ${noRefTotal > 0 ? ((noRefWins/noRefTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(noRefProfit, noRefTotal)} | Profit: €${noRefProfit.toFixed(2)}`);
  console.log(`[SOLO SCOMMESSE CON ARBITRO]   Bets: ${refTotal} | WinRate: ${refTotal > 0 ? ((refWins/refTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(refProfit, refTotal)} | Profit: €${refProfit.toFixed(2)}`);
  console.log(`\n[TOTALE COMBINATO]             Bets: ${eliteTotal} | WinRate: ${eliteTotal > 0 ? ((eliteWins/eliteTotal)*100).toFixed(2) : 0}% | Yield: ${formatYield(eliteProfit, eliteTotal)} | Profit: €${eliteProfit.toFixed(2)}`);
}

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  console.log(`Analizzando ${res.rows.length} scommesse refertate...\n`);
  runCombinedAnalysis(res.rows);
}

start().catch(console.error);
