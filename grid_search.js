const fs = require('fs');
const { createClient } = require('@libsql/client');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

async function run() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  
  console.log('Caricamento dati dal database...');
  const res = await db.execute(`
    SELECT outcome, probability, sportium, sportbet, best_edge,
           home_hist_pct, away_hist_pct, ref_hist_pct,
           home_hist_sample, away_hist_sample, ref_hist_sample,
           form_home_pct, form_away_pct, form_ref_pct, hist_score
    FROM backtest_bets 
    WHERE outcome IN ('WIN', 'LOSS')
  `);
  
  const bets = res.rows.map(b => {
    // Pre-calculate custom form score (average of home and away form)
    let formScore = null;
    if (b.form_home_pct !== null && b.form_away_pct !== null) {
      formScore = (b.form_home_pct + b.form_away_pct) / 2;
    }
    return { ...b, formScore };
  });

  console.log(`Analizzando ${bets.length} scommesse concluse...`);

  const edgeOptions = [0.15, 0.20, 0.25, 0.28, 0.30];
  const probOptions = [0.60, 0.65, 0.70, 0.75];
  const histOptions = [0, 0.50, 0.60, 0.65, 0.70, 0.75];
  const formOptions = [0, 0.50, 0.60, 0.65, 0.70, 0.75, 0.80];

  const results = [];

  for (const minEdge of edgeOptions) {
    for (const minProb of probOptions) {
      for (const minHist of histOptions) {
        for (const minForm of formOptions) {
          
          let wins = 0;
          let total = 0;
          let profit = 0;

          for (const b of bets) {
            if (b.best_edge < minEdge) continue;
            if (b.probability < minProb) continue;
            
            // Hist filter
            if (minHist > 0) {
              if (b.hist_score === null || b.hist_score < minHist) continue;
            }
            
            // Form filter
            if (minForm > 0) {
              if (b.formScore === null || b.formScore < minForm) continue;
            }

            total++;
            if (b.outcome === 'WIN') {
              wins++;
              const odds = Math.max(b.sportium || 1, b.sportbet || 1);
              profit += (odds - 1);
            } else {
              profit -= 1;
            }
          }

          // Filtriamo solo i risultati con campione tra 15 e 60 bet
          if (total >= 15 && total <= 65) {
            const hitRate = wins / total;
            const yieldPct = profit / total;
            
            // Vogliamo risultati con P&L positivo
            if (profit > 0) {
              results.push({
                edge: minEdge,
                prob: minProb,
                hist: minHist,
                form: minForm,
                total,
                wins,
                hitRate,
                yield: yieldPct,
                profit
              });
            }
          }
          
        }
      }
    }
  }

  // Ordiniamo per Yield decrescente, poi per P&L
  results.sort((a, b) => {
    // Ordiniamo prima per yield e poi per profitto, oppure creiamo un super-score combinato
    if (Math.abs(a.yield - b.yield) < 0.05) {
      // Se lo yield è simile (entro 5%), preferisci quello con profitto assoluto maggiore
      return b.profit - a.profit;
    }
    return b.yield - a.yield;
  });

  console.log('\\n🏆 I 10 MIGLIORI FILTRI (Campione 15-60 bet):\\n');
  const top10 = results.slice(0, 15);
  
  top10.forEach((r, i) => {
    console.log(`${i+1}. Edge > ${Math.round(r.edge*100)}% | Prob > ${Math.round(r.prob*100)}% | Hist > ${Math.round(r.hist*100)}% | Form > ${Math.round(r.form*100)}%`);
    console.log(`   👉 Bets: ${r.total} | HR: ${(r.hitRate*100).toFixed(1)}% | Yield: ${(r.yield*100).toFixed(1)}% | P&L: +${r.profit.toFixed(2)} U`);
    console.log('--------------------------------------------------');
  });

}

run().catch(console.error);
