const fs = require('fs');
const { createClient } = require('@libsql/client');

// Carica variabili d'ambiente
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

function formatYield(profit, bets) {
  if (bets === 0) return '0.00%';
  return ((profit / bets) * 100).toFixed(2) + '%';
}

function analyzeForm(bets, threshold) {
  let specWins = 0, specTotal = 0, specProfit = 0;
  let all4Wins = 0, all4Total = 0, all4Profit = 0;

  for (const b of bets) {
    if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;

    const win = b.outcome === 'WIN';
    const profit = win ? b.best_edge : -1;

    // Specifica (Casa / Trasferta)
    if (b.form_home_pct !== null && b.form_away_pct !== null) {
      const avgSpec = (b.form_home_pct + b.form_away_pct) / 2;
      if (avgSpec > threshold) {
        specTotal++;
        if (win) specWins++;
        specProfit += profit;
      }
    }

    // Tutti e 4 i valori (Specifica + Generale)
    if (b.form_home_pct !== null && b.form_away_pct !== null && b.form_home_gen_pct !== null && b.form_away_gen_pct !== null) {
      const avgAll4 = (b.form_home_pct + b.form_away_pct + b.form_home_gen_pct + b.form_away_gen_pct) / 4;
      if (avgAll4 > threshold) {
        all4Total++;
        if (win) all4Wins++;
        all4Profit += profit;
      }
    }
  }

  return {
    threshold: `>${threshold * 100}%`,
    specific: {
      bets: specTotal,
      winRate: specTotal > 0 ? ((specWins / specTotal) * 100).toFixed(2) + '%' : '0%',
      profit: specProfit.toFixed(2),
      yield: formatYield(specProfit, specTotal)
    },
    all4: {
      bets: all4Total,
      winRate: all4Total > 0 ? ((all4Wins / all4Total) * 100).toFixed(2) + '%' : '0%',
      profit: all4Profit.toFixed(2),
      yield: formatYield(all4Profit, all4Total)
    }
  };
}

function analyzeHistoryWithRef(bets, threshold) {
  // Solo scommesse con arbitro
  const refBets = bets.filter(b => b.ref_hist_pct !== null);
  
  let all5Wins = 0, all5Total = 0, all5Profit = 0;
  let weightedWins = 0, weightedTotal = 0, weightedProfit = 0;

  for (const b of refBets) {
    if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;

    const win = b.outcome === 'WIN';
    const profit = win ? b.best_edge : -1;

    if (b.home_hist_pct !== null && b.away_hist_pct !== null && b.home_hist_overall_pct !== null && b.away_hist_overall_pct !== null && b.ref_hist_pct !== null) {
      // Test A: Media dei 5 parametri
      const avg5 = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct + b.ref_hist_pct) / 5;
      if (avg5 > threshold) {
        all5Total++;
        if (win) all5Wins++;
        all5Profit += profit;
      }

      // Test B: Media 4 parametri -> poi Media con arbitro
      const avg4 = (b.home_hist_pct + b.away_hist_pct + b.home_hist_overall_pct + b.away_hist_overall_pct) / 4;
      const weightedAvg = (avg4 + b.ref_hist_pct) / 2;
      if (weightedAvg > threshold) {
        weightedTotal++;
        if (win) weightedWins++;
        weightedProfit += profit;
      }
    }
  }

  return {
    threshold: `>${threshold * 100}%`,
    all5: {
      bets: all5Total,
      winRate: all5Total > 0 ? ((all5Wins / all5Total) * 100).toFixed(2) + '%' : '0%',
      profit: all5Profit.toFixed(2),
      yield: formatYield(all5Profit, all5Total)
    },
    weighted: {
      bets: weightedTotal,
      winRate: weightedTotal > 0 ? ((weightedWins / weightedTotal) * 100).toFixed(2) + '%' : '0%',
      profit: weightedProfit.toFixed(2),
      yield: formatYield(weightedProfit, weightedTotal)
    }
  };
}

async function run() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const bets = res.rows;

  console.log(`Analizzando ${bets.length} scommesse refertate...\n`);

  console.log('--- TEST FORMA ---');
  console.log('Confronto: Media (Casa Spec + Trasf Spec) VS Media (Tutti e 4 i valori)');
  const thresholds = [0.50, 0.60, 0.70];
  for (const t of thresholds) {
    const res = analyzeForm(bets, t);
    console.log(`\nSoglia: ${res.threshold}`);
    console.log(`[Solo Specifiche] Bets: ${res.specific.bets} | WinRate: ${res.specific.winRate} | Yield: ${res.specific.yield} | Profit: €${res.specific.profit}`);
    console.log(`[Tutti e 4]       Bets: ${res.all4.bets} | WinRate: ${res.all4.winRate} | Yield: ${res.all4.yield} | Profit: €${res.all4.profit}`);
  }

  console.log('\n=========================================\n');

  console.log('--- TEST STORICO (SOLO CON ARBITRO) ---');
  console.log('Confronto: Media dei 5 parametri VS Media((Media 4) e Arbitro)');
  for (const t of [0.70]) {
    const res = analyzeHistoryWithRef(bets, t);
    console.log(`\nSoglia: ${res.threshold}`);
    console.log(`[Media 5 Valori]        Bets: ${res.all5.bets} | WinRate: ${res.all5.winRate} | Yield: ${res.all5.yield} | Profit: €${res.all5.profit}`);
    console.log(`[Media(Media4, Arbitro)] Bets: ${res.weighted.bets} | WinRate: ${res.weighted.winRate} | Yield: ${res.weighted.yield} | Profit: €${res.weighted.profit}`);
  }
}

run().catch(console.error);
