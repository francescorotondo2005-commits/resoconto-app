/**
 * Motore Statistico — Port esatto 1:1 dall'Apps Script
 * EV_AVANZATO e SD_AVANZATO con pesatura temporale cronologica
 */

function parseDateToTime(dateVal) {
  if (!dateVal) return 0;
  if (dateVal instanceof Date) return dateVal.getTime();
  if (typeof dateVal === 'string') {
    // Try ISO format first (YYYY-MM-DD)
    const isoDate = new Date(dateVal);
    if (!isNaN(isoDate.getTime())) return isoDate.getTime();
    // Try DD/MM/YYYY format
    const parts = dateVal.split('/');
    if (parts.length === 3) {
      return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    }
  }
  return 0;
}

function getStat(match, tipoStat, isCasa) {
  const isCartellini = tipoStat.toLowerCase() === 'cartellini';
  const isParate = tipoStat.toLowerCase() === 'parate';

  if (isCartellini) {
    const gialli = isCasa ? match.home_yellows : match.away_yellows;
    const rossi = isCasa ? match.home_reds : match.away_reds;
    return Number(gialli) + (Number(rossi) * 2);
  }
  if (isParate) {
    // Parate = TIP subiti - Gol subiti
    const tip = isCasa ? match.away_sot : match.home_sot;
    const gol = isCasa ? match.away_goals : match.home_goals;
    return Math.max(0, Number(tip) - Number(gol));
  }

  const statMap = {
    'gol': { home: 'home_goals', away: 'away_goals' },
    'tiri': { home: 'home_shots', away: 'away_shots' },
    'tip': { home: 'home_sot', away: 'away_sot' },
    'falli': { home: 'home_fouls', away: 'away_fouls' },
    'corner': { home: 'home_corners', away: 'away_corners' },
  };

  const key = tipoStat.toLowerCase();
  if (statMap[key]) {
    return Number(match[isCasa ? statMap[key].home : statMap[key].away]);
  }
  return 0;
}

function getTimeRange(matches) {
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
  return { minTime, maxTime, timeRange };
}

/**
 * EV_AVANZATO — Calcola il Valore Atteso con pesatura temporale e indice di campo
 * Port esatto 1:1 dall'Apps Script
 */
export function EV_AVANZATO(squadraCasa, squadraOspite, tipoStat, target, matches) {
  try {
    if (!matches || matches.length === 0) return 0;

    const { minTime, timeRange } = getTimeRange(matches);

    function calcolaMediePonderate(team) {
      let sumCasa = 0, weightCasa = 0;
      let sumTrasferta = 0, weightTrasferta = 0;
      let sumSubitiCasa = 0, sumSubitiTrasferta = 0;

      for (const r of matches) {
        const t = parseDateToTime(r.date);
        const w = t > 0 ? (1 + ((t - minTime) / timeRange) * 0.5) : 1;

        if (r.home_team.toLowerCase() === team.toLowerCase()) {
          sumCasa += getStat(r, tipoStat, true) * w;
          sumSubitiCasa += getStat(r, tipoStat, false) * w;
          weightCasa += w;
        } else if (r.away_team.toLowerCase() === team.toLowerCase()) {
          sumTrasferta += getStat(r, tipoStat, false) * w;
          sumSubitiTrasferta += getStat(r, tipoStat, true) * w;
          weightTrasferta += w;
        }
      }

      const mediaCasa = weightCasa > 0 ? sumCasa / weightCasa : 0.1;
      const mediaTrasferta = weightTrasferta > 0 ? sumTrasferta / weightTrasferta : 0.1;
      const mediaSubitiCasa = weightCasa > 0 ? sumSubitiCasa / weightCasa : 0.1;
      const mediaSubitiTrasferta = weightTrasferta > 0 ? sumSubitiTrasferta / weightTrasferta : 0.1;

      const totaleWeight = weightCasa + weightTrasferta;
      const mediaGlobale = totaleWeight > 0 ? (sumCasa + sumTrasferta) / totaleWeight : 0.1;
      const mediaSubitiGlobale = totaleWeight > 0 ? (sumSubitiCasa + sumSubitiTrasferta) / totaleWeight : 0.1;

      const indiceCasa = mediaCasa / mediaGlobale;
      const indiceTrasferta = mediaTrasferta / mediaGlobale;
      const indiceSubitiCasa = mediaSubitiCasa / mediaSubitiGlobale;
      const indiceSubitiTrasferta = mediaSubitiTrasferta / mediaSubitiGlobale;

      return {
        globale: mediaGlobale, subitiGlobale: mediaSubitiGlobale,
        idxCasa: indiceCasa, idxTrasferta: indiceTrasferta,
        idxSubitiCasa: indiceSubitiCasa, idxSubitiTrasferta: indiceSubitiTrasferta,
      };
    }

    const statCasa = calcolaMediePonderate(squadraCasa);
    const statOspite = calcolaMediePonderate(squadraOspite);

    let evFinale = 0;
    if (target.toLowerCase() === 'casa') {
      const forzaAttaccoCasa = statCasa.globale * statCasa.idxCasa;
      const forzaDifesaOspite = statOspite.subitiGlobale * statOspite.idxSubitiTrasferta;
      evFinale = (forzaAttaccoCasa + forzaDifesaOspite) / 2;
    } else if (target.toLowerCase() === 'ospite') {
      const forzaAttaccoOspite = statOspite.globale * statOspite.idxTrasferta;
      const forzaDifesaCasa = statCasa.subitiGlobale * statCasa.idxSubitiCasa;
      evFinale = (forzaAttaccoOspite + forzaDifesaCasa) / 2;
    } else {
      return 0;
    }

    return Math.round(evFinale * 100) / 100;
  } catch (e) {
    console.error('Errore EV_AVANZATO:', e);
    return 0;
  }
}

/**
 * SD_AVANZATO — Calcola la Deviazione Standard con pesatura temporale
 * Port esatto 1:1 dall'Apps Script
 */
export function SD_AVANZATO(squadraCasa, squadraOspite, tipoStat, target, matches) {
  try {
    if (!matches || matches.length === 0) return 0;

    const { minTime, timeRange } = getTimeRange(matches);

    function calcolaSDPonderata(team, calcFatti, isHomeMatch) {
      const vals = [], weights = [];
      let sumW = 0, sumWX = 0;

      for (const r of matches) {
        const t = parseDateToTime(r.date);
        const w = t > 0 ? (1 + ((t - minTime) / timeRange) * 0.5) : 1;

        if (isHomeMatch && r.home_team.toLowerCase() === team.toLowerCase()) {
          const val = getStat(r, tipoStat, calcFatti);
          vals.push(val); weights.push(w);
          sumW += w; sumWX += val * w;
        } else if (!isHomeMatch && r.away_team.toLowerCase() === team.toLowerCase()) {
          const val = getStat(r, tipoStat, !calcFatti);
          vals.push(val); weights.push(w);
          sumW += w; sumWX += val * w;
        }
      }

      if (sumW === 0) return 0;

      const wMean = sumWX / sumW;
      let sumWDiffSq = 0;

      for (let j = 0; j < vals.length; j++) {
        sumWDiffSq += weights[j] * Math.pow(vals[j] - wMean, 2);
      }
      return Math.sqrt(sumWDiffSq / sumW);
    }

    let sdFinale = 0;
    if (target.toLowerCase() === 'casa') {
      const varAttaccoCasa = Math.pow(calcolaSDPonderata(squadraCasa, true, true), 2);
      const varDifesaOspite = Math.pow(calcolaSDPonderata(squadraOspite, false, false), 2);
      sdFinale = Math.sqrt((varAttaccoCasa + varDifesaOspite) / 2);
    } else if (target.toLowerCase() === 'ospite') {
      const varAttaccoOspite = Math.pow(calcolaSDPonderata(squadraOspite, true, false), 2);
      const varDifesaCasa = Math.pow(calcolaSDPonderata(squadraCasa, false, true), 2);
      sdFinale = Math.sqrt((varAttaccoOspite + varDifesaCasa) / 2);
    } else {
      return 0;
    }

    return Math.round(sdFinale * 100) / 100;
  } catch (e) {
    console.error('Errore SD_AVANZATO:', e);
    return 0;
  }
}

/**
 * CV_CALC — Coefficiente di Variazione
 */
export function CV_CALC(ev, sd) {
  if (ev <= 0) return 0;
  return Number(sd) / Number(ev);
}
