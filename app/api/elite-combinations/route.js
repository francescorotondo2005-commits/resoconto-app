import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { writeFile } from 'fs/promises';
import path from 'path';

export async function POST(request) {
  try {
    const { minWinRate = 0.80, minBets = 14, minQuota = 1.60, topK = 5000 } = await request.json();

    const db = await getDb();
    const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
    const rawBets = res.rows;

    const bets = [];
    for (const b of rawBets) {
      const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
      if (maxOdds < minQuota) continue;

      const win = b.outcome === 'WIN';
      const profit = win ? (maxOdds - 1) : -1;

      const fParts = [];
      if (b.form_home_pct !== null) fParts.push(b.form_home_pct);
      if (b.form_away_pct !== null) fParts.push(b.form_away_pct);
      if (b.form_home_gen_pct !== null) fParts.push(b.form_home_gen_pct);
      if (b.form_away_gen_pct !== null) fParts.push(b.form_away_gen_pct);
      const formScore = fParts.length > 0 ? fParts.reduce((a, v) => a + v, 0) / fParts.length : null;
      const fMin = fParts.length === 4 ? Math.min(...fParts) : null;

      const hParts = [];
      if (b.home_hist_pct !== null) hParts.push(b.home_hist_pct);
      if (b.away_hist_pct !== null) hParts.push(b.away_hist_pct);
      if (b.home_hist_overall_pct !== null) hParts.push(b.home_hist_overall_pct);
      if (b.away_hist_overall_pct !== null) hParts.push(b.away_hist_overall_pct);
      const hasRef = b.ref_hist_pct !== null;
      if (hasRef) hParts.push(b.ref_hist_pct);
      const histScore = hParts.length > 0 ? hParts.reduce((a, v) => a + v, 0) / hParts.length : null;
      const hFullLen = hasRef ? 5 : 4;
      const hMin = hParts.length === hFullLen ? Math.min(...hParts) : null;

      bets.push({
        win, profit,
        edge: b.best_edge || 0,
        prob: b.probability || 0,
        formScore, fMin, histScore, hMin
      });
    }

    const uniqueVals = (arr, min, max) => {
      const s = new Set([min]);
      for (const v of arr) if (v !== null && v !== undefined) s.add(Math.round(v * 100) / 100);
      return Array.from(s).filter(v => v >= min && v <= max).sort((a, b) => a - b);
    };

    const edgeT   = uniqueVals(bets.map(b => b.edge),      0,    0.5);
    const probT   = uniqueVals(bets.map(b => b.prob),      0.50, 1.0);
    const hAvgT   = uniqueVals(bets.map(b => b.histScore), 0,    1.0);
    const hSngT   = uniqueVals([0, ...bets.map(b => b.hMin).filter(v => v !== null)], 0, 1.0);
    const fAvgT   = uniqueVals(bets.map(b => b.formScore), 0,    1.0);
    const fSngT   = uniqueVals([0, ...bets.map(b => b.fMin).filter(v => v !== null)],  0, 1.0);

    const allResults = new Map();

    for (const minEdge of edgeT) {
      const a1 = bets.filter(b => b.edge >= minEdge);
      if (a1.length < minBets) break;

      for (const minProb of probT) {
        const a2 = a1.filter(b => b.prob >= minProb);
        if (a2.length < minBets) break;

        for (const minHistAvg of hAvgT) {
          const a3 = a2.filter(b => b.histScore !== null && b.histScore >= minHistAvg);
          if (a3.length < minBets) break;

          for (const minHistSingle of hSngT) {
            const a4 = minHistSingle === 0 ? a3 : a3.filter(b => b.hMin !== null && b.hMin >= minHistSingle);
            if (a4.length < minBets) break;

            for (const minFormAvg of fAvgT) {
              const a5 = a4.filter(b => b.formScore !== null && b.formScore >= minFormAvg);
              if (a5.length < minBets) break;

              for (const minFormSingle of fSngT) {
                const final = minFormSingle === 0 ? a5 : a5.filter(b => b.fMin !== null && b.fMin >= minFormSingle);
                if (final.length < minBets) break;

                const total = final.length;
                const wins  = final.filter(b => b.win).length;
                const winRate = wins / total;

                if (winRate >= minWinRate) {
                  const profit = final.reduce((s, b) => s + b.profit, 0);
                  const yieldPct = profit / total;
                  const key = `${total}|${wins}|${profit.toFixed(4)}`;
                  if (!allResults.has(key)) {
                    allResults.set(key, {
                      total, wins, winRate, profit, yieldPct,
                      params: { minEdge, minProb, minHistAvg, minHistSingle, minFormAvg, minFormSingle }
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    let sorted = Array.from(allResults.values());
    sorted.sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.total !== a.total) return b.total - a.total;
      return b.yieldPct - a.yieldPct;
    });
    sorted = sorted.slice(0, topK);

    // Salva il file JSON nella cartella public/ per renderlo disponibile lato client
    const jsonPath = path.join(process.cwd(), 'public', 'topCombinations.json');
    await writeFile(jsonPath, JSON.stringify({ combinations: sorted, generatedAt: new Date().toISOString() }, null, 2), 'utf8');

    return NextResponse.json({
      count: sorted.length,
      message: `Calcolo completato! ${sorted.length} combinazioni Elite trovate e salvate.`,
      generatedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Elite combinations error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
