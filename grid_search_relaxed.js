/**
 * GRID SEARCH V4 — Zero Allocation Bitmask Approach.
 *
 * Avoids any garbage collection by pre-allocating all working masks.
 * Inlines the counting logic. This runs close to C-level speeds.
 */
import fs from 'fs';
import { createClient } from '@libsql/client';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

let MIN_BETS    = 20;
let MIN_WINRATE = 0.80;
let MIN_QUOTA   = 1.60;
let TOP_K       = 5000;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--minWinRate') MIN_WINRATE = parseFloat(args[++i]);
  if (args[i] === '--minBets')    MIN_BETS    = parseInt(args[++i], 10);
  if (args[i] === '--minQuota')   MIN_QUOTA   = parseFloat(args[++i]);
  if (args[i] === '--topK')       TOP_K       = parseInt(args[++i], 10);
}

function getValidThresholds(values, minVal, maxVal, minBets) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (valid.length < minBets) return [minVal];
  const sorted = [...valid].sort((a, b) => b - a);
  const maxAllowed = sorted[minBets - 1];
  const set = new Set([minVal]);
  for (const v of valid) {
    if (v <= maxAllowed) set.add(Math.round(v * 100) / 100);
  }
  return Array.from(set).filter(v => v >= minVal && v <= maxVal).sort((a, b) => a - b);
}

// Highly optimized 32-bit popcount
function popcnt32(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return Math.imul((n + (n >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

async function start() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const res = await db.execute("SELECT * FROM backtest_bets WHERE outcome IN ('WIN', 'LOSS')");
  const rawBets = res.rows;

  const bets = [];
  for (const b of rawBets) {
    const maxOdds = Math.max(b.sportium || 0, b.sportbet || 0);
    if (maxOdds < MIN_QUOTA) continue;
    const win = b.outcome === 'WIN';
    const profit = win ? (maxOdds - 1) : -1;
    const histScore = b.hist_score;
    const fParts = [];
    if (b.form_home_pct     !== null) fParts.push(b.form_home_pct);
    if (b.form_away_pct     !== null) fParts.push(b.form_away_pct);
    if (b.form_home_gen_pct !== null) fParts.push(b.form_home_gen_pct);
    if (b.form_away_gen_pct !== null) fParts.push(b.form_away_gen_pct);
    const formScore = fParts.length > 0 ? fParts.reduce((a, v) => a + v, 0) / fParts.length : null;
    const fMin = fParts.length === 4 ? Math.min(...fParts) : null;
    const hParts = [];
    if (b.home_hist_pct         !== null) hParts.push(b.home_hist_pct);
    if (b.away_hist_pct         !== null) hParts.push(b.away_hist_pct);
    if (b.home_hist_overall_pct !== null) hParts.push(b.home_hist_overall_pct);
    if (b.away_hist_overall_pct !== null) hParts.push(b.away_hist_overall_pct);
    if (b.ref_hist_pct          !== null) hParts.push(b.ref_hist_pct);
    const hMin = hParts.length >= 4 ? Math.min(...hParts) : null;
    bets.push({ win, profit, edge: b.best_edge || 0, prob: b.probability || 0, cv: b.cv || 0,
      formScore, fMin, histScore, hMin });
  }

  const N = bets.length;
  console.log(`Bets caricate: ${N}`);

  const INT_COUNT = Math.ceil(N / 32);
  const WIN_MASK = new Int32Array(INT_COUNT);
  const PROFIT = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    if (bets[i].win) {
      WIN_MASK[i >> 5] |= (1 << (i & 31));
    }
    PROFIT[i] = bets[i].profit;
  }

  const eps = 0.0001;
  const MIN_WINS = Math.ceil(MIN_BETS * MIN_WINRATE);

  const sortedEdgesDesc = bets.map(b => b.edge).sort((a, b) => b - a);
  const maxEdge = sortedEdgesDesc.length >= MIN_BETS ? sortedEdgesDesc[MIN_BETS - 1] : -0.50;
  const edgeThresholds = [];
  for (let e = -0.50; e <= Math.min(0.90, maxEdge + 0.001); e += 0.01)
    edgeThresholds.push(Math.round(e * 100) / 100);

  const probThresholds     = getValidThresholds(bets.map(b => b.prob),                                 0.50, 1.0, MIN_BETS);
  const histAvgThresholds  = getValidThresholds(bets.map(b => b.histScore),                            0,    1.0, MIN_BETS);
  const histSingThresholds = getValidThresholds([0, ...bets.map(b => b.hMin).filter(v => v !== null)], 0,    1.0, MIN_BETS);
  const formAvgThresholds  = getValidThresholds(bets.map(b => b.formScore),                            0,    1.0, MIN_BETS);
  const formSingThresholds = getValidThresholds([0, ...bets.map(b => b.fMin).filter(v => v !== null)], 0,    1.0, MIN_BETS);
  const cvThresholds = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];

  console.log(`Soglie: edge(${edgeThresholds.length}) prob(${probThresholds.length}) hAvg(${histAvgThresholds.length}) hSng(${histSingThresholds.length}) fAvg(${formAvgThresholds.length}) fSng(${formSingThresholds.length}) cv(${cvThresholds.length})`);

  function buildMasks(thresholds, getter) {
    return thresholds.map(thr => {
      const m = new Int32Array(INT_COUNT);
      for (let i = 0; i < N; i++) {
        const v = getter(bets[i]);
        if (v !== null && v !== undefined && v >= thr - eps) {
          m[i >> 5] |= (1 << (i & 31));
        }
      }
      return m;
    });
  }

  console.log('Pre-calcolo mask...');
  const edgeMasks     = buildMasks(edgeThresholds,     b => b.edge);
  const probMasks     = buildMasks(probThresholds,     b => b.prob);
  const histAvgMasks  = buildMasks(histAvgThresholds,  b => b.histScore);
  const histSingMasks = buildMasks(histSingThresholds, b => b.hMin);
  const formAvgMasks  = buildMasks(formAvgThresholds,  b => b.formScore);
  const formSingMasks = buildMasks(formSingThresholds, b => b.fMin);

  const cvMasksFixed = cvThresholds.map(maxCV => {
    const m = new Int32Array(INT_COUNT);
    for (let i = 0; i < N; i++) {
      if (maxCV >= 1.0 || bets[i].cv <= maxCV) {
        m[i >> 5] |= (1 << (i & 31));
      }
    }
    return m;
  });

  console.log('Inizio loop...');
  const allResults = new Map();
  let totalTested = 0;
  const startTime = Date.now();

  // Pre-allocate working arrays to avoid GC overhead
  const mEP    = new Int32Array(INT_COUNT);
  const mEPH   = new Int32Array(INT_COUNT);
  const mEPHS  = new Int32Array(INT_COUNT);
  const mEPHSF = new Int32Array(INT_COUNT);
  const mFinal = new Int32Array(INT_COUNT);
  const mCV    = new Int32Array(INT_COUNT);

  let lastEdgeLen = -1;
  for (let ei = 0; ei < edgeMasks.length; ei++) {
    const mEdge = edgeMasks[ei];
    let totE = 0, winE = 0;
    for (let i = 0; i < INT_COUNT; i++) {
      const v = mEdge[i];
      if (v !== 0) {
        totE += popcnt32(v);
        winE += popcnt32(v & WIN_MASK[i]);
      }
    }
    if (totE < MIN_BETS || winE < MIN_WINS) break;
    if (totE === lastEdgeLen) continue;
    lastEdgeLen = totE;
    const minEdge = edgeThresholds[ei];

    let lastProbLen = -1;
    for (let pi = 0; pi < probMasks.length; pi++) {
      const pm = probMasks[pi];
      let totP = 0, winP = 0;
      for (let i = 0; i < INT_COUNT; i++) {
        const v = mEdge[i] & pm[i];
        mEP[i] = v;
        if (v !== 0) {
          totP += popcnt32(v);
          winP += popcnt32(v & WIN_MASK[i]);
        }
      }
      if (totP < MIN_BETS || winP < MIN_WINS) break;
      if (totP === lastProbLen) continue;
      lastProbLen = totP;
      const minProb = probThresholds[pi];

      let lastHAvgLen = -1;
      for (let hai = 0; hai < histAvgMasks.length; hai++) {
        let totH = 0, winH = 0;
        const ham = histAvgMasks[hai];
        const isZero = histAvgThresholds[hai] === 0;
        for (let i = 0; i < INT_COUNT; i++) {
          const v = isZero ? mEP[i] : (mEP[i] & ham[i]);
          mEPH[i] = v;
          if (v !== 0) {
            totH += popcnt32(v);
            winH += popcnt32(v & WIN_MASK[i]);
          }
        }
        if (!isZero && totH === totP) continue;
        if (totH < MIN_BETS || winH < MIN_WINS) break;
        if (totH === lastHAvgLen) continue;
        lastHAvgLen = totH;
        const minHistAvg = histAvgThresholds[hai];

        let lastHSngLen = -1;
        for (let hsi = 0; hsi < histSingMasks.length; hsi++) {
          let totHS = 0, winHS = 0;
          const hsm = histSingMasks[hsi];
          const isZeroS = histSingThresholds[hsi] === 0;
          for (let i = 0; i < INT_COUNT; i++) {
            const v = isZeroS ? mEPH[i] : (mEPH[i] & hsm[i]);
            mEPHS[i] = v;
            if (v !== 0) {
              totHS += popcnt32(v);
              winHS += popcnt32(v & WIN_MASK[i]);
            }
          }
          if (!isZeroS && totHS === totH) continue;
          if (totHS < MIN_BETS || winHS < MIN_WINS) break;
          if (totHS === lastHSngLen) continue;
          lastHSngLen = totHS;
          const minHistSingle = histSingThresholds[hsi];

          let lastFAvgLen = -1;
          for (let fai = 0; fai < formAvgMasks.length; fai++) {
            let totF = 0, winF = 0;
            const fam = formAvgMasks[fai];
            const isZeroF = formAvgThresholds[fai] === 0;
            for (let i = 0; i < INT_COUNT; i++) {
              const v = isZeroF ? mEPHS[i] : (mEPHS[i] & fam[i]);
              mEPHSF[i] = v;
              if (v !== 0) {
                totF += popcnt32(v);
                winF += popcnt32(v & WIN_MASK[i]);
              }
            }
            if (!isZeroF && totF === totHS) continue;
            if (totF < MIN_BETS || winF < MIN_WINS) break;
            if (totF === lastFAvgLen) continue;
            lastFAvgLen = totF;
            const minFormAvg = formAvgThresholds[fai];

            let lastFSngLen = -1;
            for (let fsi = 0; fsi < formSingMasks.length; fsi++) {
              let totFS = 0, winFS = 0;
              const fsm = formSingMasks[fsi];
              const isZeroFS = formSingThresholds[fsi] === 0;
              for (let i = 0; i < INT_COUNT; i++) {
                const v = isZeroFS ? mEPHSF[i] : (mEPHSF[i] & fsm[i]);
                mFinal[i] = v;
                if (v !== 0) {
                  totFS += popcnt32(v);
                  winFS += popcnt32(v & WIN_MASK[i]);
                }
              }
              if (!isZeroFS && totFS === totF) continue;
              if (totFS < MIN_BETS || winFS < MIN_WINS) break;
              if (totFS === lastFSngLen) continue;
              lastFSngLen = totFS;
              const minFormSingle = formSingThresholds[fsi];

              for (let cvi = 0; cvi < cvMasksFixed.length; cvi++) {
                let cvTotal = 0, cvWins = 0;
                const cvm = cvMasksFixed[cvi];
                for (let i = 0; i < INT_COUNT; i++) {
                  const v = mFinal[i] & cvm[i];
                  mCV[i] = v;
                  if (v !== 0) {
                    cvTotal += popcnt32(v);
                    cvWins += popcnt32(v & WIN_MASK[i]);
                  }
                }
                if (cvTotal < MIN_BETS) break;
                totalTested++;
                const winRate = cvWins / cvTotal;
                if (winRate >= MIN_WINRATE) {
                  let cvProfit = 0;
                  for (let i = 0; i < N; i++) {
                    if ((mCV[i >> 5] & (1 << (i & 31))) !== 0) {
                      cvProfit += PROFIT[i];
                    }
                  }
                  const key = `${cvTotal}|${cvWins}|${cvProfit.toFixed(4)}`;
                  if (!allResults.has(key)) {
                    allResults.set(key, {
                      total: cvTotal, wins: cvWins, winRate, profit: cvProfit,
                      yieldPct: cvProfit / cvTotal,
                      params: { minEdge, minProb, minHistAvg, minHistSingle, minFormAvg, minFormSingle, maxCV: cvThresholds[cvi] }
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompletato in ${elapsed}s. Testate: ${totalTested.toLocaleString()}, Uniche: ${allResults.size}`);

  let uniqueCombos = Array.from(allResults.values());
  uniqueCombos.sort((a, b) => {
    if (b.winRate  !== a.winRate)  return b.winRate  - a.winRate;
    if (b.total    !== a.total)    return b.total    - a.total;
    return b.yieldPct - a.yieldPct;
  });
  uniqueCombos = uniqueCombos.slice(0, TOP_K);

  console.log(`Top ${TOP_K}: ${uniqueCombos.length} combinazioni.`);
  const output = { results: uniqueCombos };
  fs.writeFileSync('grid_search_results_relaxed.json', JSON.stringify(output, null, 2));
  console.log('Salvato grid_search_results_relaxed.json');
}

start().catch(console.error);
