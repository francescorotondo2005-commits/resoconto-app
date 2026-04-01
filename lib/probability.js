/**
 * Probability Functions — Port esatto dall'Apps Script
 * PROB_BINOM_NEG e PROB_1X2_IBRIDO
 */

function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function gammaln(z) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = z, x = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j <= 5; j++) ser += cof[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * PROB_BINOM_NEG — Calcola probabilità Over/Under usando Binomiale Negativa
 * Port esatto 1:1
 */
export function PROB_BINOM_NEG(linea, ev, sd, mercato) {
  try {
    const m = Number(ev);
    const v = Math.pow(Number(sd), 2);
    const k_max = Math.floor(Number(linea));

    if (m <= 0) return 0;

    // Se varianza <= media, usa Poisson
    if (v <= m) {
      let probUnder = 0;
      for (let k = 0; k <= k_max; k++) {
        probUnder += (Math.pow(m, k) * Math.exp(-m)) / factorial(k);
      }
      return mercato.toLowerCase() === 'over' ? (1 - probUnder) : probUnder;
    }

    // Binomiale Negativa
    const p = m / v;
    const r = (m * m) / (v - m);

    let probUnder = 0;
    for (let k = 0; k <= k_max; k++) {
      const logPmf = gammaln(r + k) - gammaln(r) - gammaln(k + 1) +
        r * Math.log(p) + k * Math.log(1 - p);
      probUnder += Math.exp(logPmf);
    }

    return mercato.toLowerCase() === 'over' ? (1 - probUnder) : probUnder;
  } catch (e) {
    console.error('Errore PROB_BINOM_NEG:', e);
    return 0;
  }
}

/**
 * PROB_1X2_IBRIDO — Calcola probabilità 1X2 per una statistica
 * Port esatto 1:1
 */
export function PROB_1X2_IBRIDO(evCasa, sdCasa, evOspite, sdOspite, esito) {
  try {
    function getPmf(m, v, k) {
      if (m <= 0) return k === 0 ? 1 : 0;
      if (v <= m) {
        let f = 1;
        for (let i = 2; i <= k; i++) f *= i;
        return (Math.pow(m, k) * Math.exp(-m)) / (k === 0 ? 1 : f);
      }
      const p = m / v;
      const r = (m * m) / (v - m);
      const logPmf = gammaln(r + k) - gammaln(r) - gammaln(k + 1) +
        r * Math.log(p) + k * Math.log(1 - p);
      return Math.exp(logPmf);
    }

    let prob1 = 0, probX = 0, prob2 = 0;
    for (let i = 0; i <= 40; i++) {
      const pCasa = getPmf(Number(evCasa), Math.pow(Number(sdCasa), 2), i);
      for (let j = 0; j <= 40; j++) {
        const pOspite = getPmf(Number(evOspite), Math.pow(Number(sdOspite), 2), j);
        const probCombinata = pCasa * pOspite;

        if (i > j) prob1 += probCombinata;
        else if (i === j) probX += probCombinata;
        else prob2 += probCombinata;
      }
    }

    const totale = prob1 + probX + prob2;

    if (esito === '1') return prob1 / totale;
    if (esito.toUpperCase() === 'X') return probX / totale;
    if (esito === '2') return prob2 / totale;
    return 0;
  } catch (e) {
    console.error('Errore PROB_1X2_IBRIDO:', e);
    return 0;
  }
}
