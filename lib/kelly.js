/**
 * Kelly Criterion — Calcolo stake ottimale
 */

/**
 * Calcola lo stake ottimale secondo il Kelly Criterion
 * @param {number} probability - Probabilità stimata (0-1)
 * @param {number} odds - Quota del bookmaker (decimale)
 * @param {number} bankroll - Bankroll attuale
 * @param {number} fraction - Frazione di Kelly (0.25 = quarter Kelly, default)
 * @returns {object} { kellyFull, kellyFraction, flatStake }
 */
export function calculateKelly(probability, odds, bankroll, fraction = 0.25) {
  const p = Number(probability);
  const q = 1 - p;
  const b = Number(odds) - 1; // net odds

  // Kelly formula: f* = (bp - q) / b
  const kellyFull = (b * p - q) / b;

  // If Kelly is negative, there's no edge — don't bet
  if (kellyFull <= 0) {
    return {
      kellyFull: 0,
      kellyFraction: 0,
      kellyStake: 0,
      flatStake: 0,
      edge: (p * Number(odds)) - 1,
      hasEdge: false,
    };
  }

  const kellyFractionValue = kellyFull * fraction;
  const kellyStake = Math.round(kellyFractionValue * Number(bankroll) * 100) / 100;

  return {
    kellyFull: Math.round(kellyFull * 10000) / 100, // percentage
    kellyFraction: Math.round(kellyFractionValue * 10000) / 100, // percentage
    kellyStake: Math.max(1, kellyStake), // min €1
    flatStake: 1, // default flat
    edge: Math.round(((p * Number(odds)) - 1) * 10000) / 100, // percentage
    hasEdge: true,
  };
}
