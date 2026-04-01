/**
 * INDICE_ARBITRO_AVANZATO — Port esatto dall'Apps Script
 * Calcola il moltiplicatore di severità dell'arbitro
 */
import { EV_AVANZATO } from './engine.js';

function parseDateToTime(dateVal) {
  if (!dateVal) return 0;
  if (dateVal instanceof Date) return dateVal.getTime();
  if (typeof dateVal === 'string') {
    const isoDate = new Date(dateVal);
    if (!isNaN(isoDate.getTime())) return isoDate.getTime();
    const parts = dateVal.split('/');
    if (parts.length === 3) {
      return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    }
  }
  return 0;
}

function getStat(match, tipoStat, isCasa) {
  const isCartellini = tipoStat.toLowerCase() === 'cartellini';
  if (isCartellini) {
    const gialli = isCasa ? match.home_yellows : match.away_yellows;
    const rossi = isCasa ? match.home_reds : match.away_reds;
    return Number(gialli) + (Number(rossi) * 2);
  }
  // Falli
  return Number(isCasa ? match.home_fouls : match.away_fouls);
}

export function INDICE_ARBITRO_AVANZATO(arbitro, tipoStat, matches) {
  try {
    if (!matches || matches.length === 0) return 1;
    if (!arbitro || arbitro === '') return 1;

    let minTime = Infinity, maxTime = -Infinity;
    for (const m of matches) {
      const t = parseDateToTime(m.date);
      if (t > 0) {
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
      }
    }
    let timeRange = maxTime - minTime;
    if (timeRange === 0) timeRange = 1;

    let sumW = 0, sumW_Ratio = 0;

    for (const row of matches) {
      if (row.referee && row.referee.toString().trim().toLowerCase() === arbitro.toString().trim().toLowerCase()) {
        const actualCasa = getStat(row, tipoStat, true);
        const actualOspite = getStat(row, tipoStat, false);
        const actualTotal = actualCasa + actualOspite;

        const evCasa = EV_AVANZATO(row.home_team, row.away_team, tipoStat, 'casa', matches);
        const evOspite = EV_AVANZATO(row.home_team, row.away_team, tipoStat, 'ospite', matches);

        if (typeof evCasa === 'number' && typeof evOspite === 'number') {
          const evTotal = evCasa + evOspite;
          if (evTotal > 0) {
            const ratio = actualTotal / evTotal;
            const timeMatch = parseDateToTime(row.date);
            const w = timeMatch > 0 ? (1 + ((timeMatch - minTime) / timeRange) * 0.5) : 1;
            sumW_Ratio += ratio * w;
            sumW += w;
          }
        }
      }
    }

    if (sumW === 0) return 1;

    const indiceFinale = sumW_Ratio / sumW;
    return Math.round(indiceFinale * 100) / 100;
  } catch (e) {
    console.error('Errore INDICE_ARBITRO_AVANZATO:', e);
    return 1;
  }
}
