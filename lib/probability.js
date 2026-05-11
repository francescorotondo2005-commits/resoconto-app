/**
 * Probability Functions — Ottimizzato per Machine Learning (Livello 3)
 * Riceve EV e Varianza direttamente dai modelli XGBoost
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
 * PROB_BINOM_NEG_ML — Calcola probabilità Over/Under
 * @param {number} linea - La linea dell'Over/Under (es. 2.5)
 * @param {number} ev - Il Valore Atteso (Output Modello A Python)
 * @param {number} varianza - La Varianza (Output Modello B Python). NOTA: Non è più la SD!
 * @param {string} mercato - 'over' o 'under'
 */
export function PROB_BINOM_NEG_ML(linea, ev, varianza, mercato) {
  try {
    const m = Number(ev);
    const v = Number(varianza);
    const k_max = Math.floor(Number(linea));

    if (m <= 0) return 0;

    // Fallback: Se varianza <= media (sottodispersione), usa Poisson pura
    if (v <= m || isNaN(v)) {
      let probUnder = 0;
      for (let k = 0; k <= k_max; k++) {
        probUnder += (Math.pow(m, k) * Math.exp(-m)) / factorial(k);
      }
      return mercato.toLowerCase() === 'over' ? (1 - probUnder) : probUnder;
    }

    // Binomiale Negativa Dinamica (Sovradispersione)
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
    console.error('Errore PROB_BINOM_NEG_ML:', e);
    return 0;
  }
}

/**
 * PROB_1X2_IBRIDO_ML — Calcola probabilità 1X2 
 * Utilizza direttamente Varianza Casa e Varianza Ospite
 */
export function PROB_1X2_IBRIDO_ML(evCasa, varCasa, evOspite, varOspite, esito) {
  try {
    function getPmf(m, v, k) {
      if (m <= 0) return k === 0 ? 1 : 0;

      // Fallback su Poisson
      if (v <= m || isNaN(v)) {
        let f = 1;
        for (let i = 2; i <= k; i++) f *= i;
        return (Math.pow(m, k) * Math.exp(-m)) / (k === 0 ? 1 : f);
      }

      // Binomiale Negativa
      const p = m / v;
      const r = (m * m) / (v - m);
      const logPmf = gammaln(r + k) - gammaln(r) - gammaln(k + 1) +
        r * Math.log(p) + k * Math.log(1 - p);
      return Math.exp(logPmf);
    }

    let prob1 = 0, probX = 0, prob2 = 0;

    // Riduciamo il loop da 40 a 25 per ragioni di performance.
    // Nel calcio (e nei corner) superare 25 eventi per singola squadra è quasi impossibile.
    for (let i = 0; i <= 25; i++) {
      const pCasa = getPmf(Number(evCasa), Number(varCasa), i);
      for (let j = 0; j <= 25; j++) {
        const pOspite = getPmf(Number(evOspite), Number(varOspite), j);
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
    console.error('Errore PROB_1X2_IBRIDO_ML:', e);
    return 0;
  }
}

/**
 * Funzioni Classiche (Livello 2) — Per retrocompatibilità con rotte pre-ML
 * Utilizzano la SD storica elevata al quadrato come varianza
 */
export function PROB_BINOM_NEG(linea, ev, sd, mercato) {
  return PROB_BINOM_NEG_ML(linea, ev, sd * sd, mercato);
}

export function PROB_1X2_IBRIDO(evCasa, sdCasa, evOspite, sdOspite, esito) {
  return PROB_1X2_IBRIDO_ML(evCasa, sdCasa * sdCasa, evOspite, sdOspite * sdOspite, esito);
}