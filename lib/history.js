/**
 * history.js — Storico Stagionale + Stato di Forma per bet del backtest
 *
 * Esporta:
 *   calcHistorySummary(homeTeam, awayTeam, referee, betName, matchesBefore)
 *   calcFormSummary(homeTeam, awayTeam, referee, betName, matchesBefore, N=5)
 *   calcHistScore(homePct, awayPct, refPct, hasRef)
 */

import { parseMarketName, getMatchStatValue } from './grading.js';

const MIN_SAMPLE_TEAM = 5;  // partite minime per usare dati squadra
const MIN_SAMPLE_REF  = 3;  // partite minime per usare dati arbitro

/**
 * Verifica se l'esito della scommessa si è verificato in una determinata partita.
 * Funziona per mercati over/under e 1x2.
 */
function checkOutcome(parsed, match, teamRole, trackType) {
  const { type, stat, direction, line, esito } = parsed;

  let actualValue = 0;
  if (trackType === 'totale') {
    actualValue = getMatchStatValue(match, stat, 'totale');
  } else if (trackType === 'made') {
    actualValue = teamRole === 'home'
      ? getMatchStatValue(match, stat, 'casa')
      : getMatchStatValue(match, stat, 'ospite');
  } else if (trackType === 'conceded') {
    actualValue = teamRole === 'home'
      ? getMatchStatValue(match, stat, 'ospite')
      : getMatchStatValue(match, stat, 'casa');
  }

  if (type === 'over_under') {
    if (direction === 'over') return actualValue > line;
    if (direction === 'under') return actualValue < line;
  } else if (type === '1x2') {
    const homeVal = getMatchStatValue(match, stat, 'casa');
    const awayVal = getMatchStatValue(match, stat, 'ospite');
    const draw = homeVal === awayVal;

    if (esito === 'X') return draw;
    if (teamRole === 'home') {
      if (trackType === 'made') return homeVal > awayVal;
      if (trackType === 'conceded') return homeVal < awayVal;
    } else {
      if (trackType === 'made') return awayVal > homeVal;
      if (trackType === 'conceded') return awayVal < homeVal;
    }
  }
  return false;
}

/**
 * Determina il trackType (come tracciare l'esito) per casa e ospite
 * in base al scope della scommessa.
 */
function getTrackTypes(parsed) {
  let trackHome = 'totale';
  let trackAway = 'totale';

  if (parsed.scope === 'casa') {
    trackHome = 'made';
    trackAway = 'conceded';
  } else if (parsed.scope === 'ospite') {
    trackHome = 'conceded';
    trackAway = 'made';
  } else if (parsed.type === '1x2') {
    if (parsed.esito === '1') { trackHome = 'made'; trackAway = 'conceded'; }
    else if (parsed.esito === '2') { trackHome = 'conceded'; trackAway = 'made'; }
  }

  return { trackHome, trackAway };
}

/**
 * calcHistorySummary — Storico stagionale (tutte le partite prima della data della bet)
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string|null} referee
 * @param {string} betName  — es. "UNDER 26,5 FALLI TOTALI"
 * @param {Array} matchesBefore — partite filtrate per data < match_date
 * @returns {object} { homePct, homeSample, awayPct, awaySample, refPct, refSample, histScore, hasRef }
 */
export function calcHistorySummary(homeTeam, awayTeam, referee, betName, matchesBefore) {
  const parsed = parseMarketName(betName);
  if (!parsed) return null;

  const { trackHome, trackAway } = getTrackTypes(parsed);

  // --- Squadra Casa (Totale e Specifica) ---
  let homeTotalOverall = 0, homeHitsOverall = 0;
  let homeTotalSpecific = 0, homeHitsSpecific = 0;
  for (const m of matchesBefore) {
    if (m.home_team?.toLowerCase() === homeTeam?.toLowerCase()) {
      homeTotalOverall++;
      homeTotalSpecific++;
      if (checkOutcome(parsed, m, 'home', trackHome)) {
        homeHitsOverall++;
        homeHitsSpecific++;
      }
    } else if (m.away_team?.toLowerCase() === homeTeam?.toLowerCase()) {
      homeTotalOverall++;
      if (checkOutcome(parsed, m, 'away', trackHome)) homeHitsOverall++;
    }
  }

  // --- Squadra Ospite (Totale e Specifica) ---
  let awayTotalOverall = 0, awayHitsOverall = 0;
  let awayTotalSpecific = 0, awayHitsSpecific = 0;
  for (const m of matchesBefore) {
    if (m.away_team?.toLowerCase() === awayTeam?.toLowerCase()) {
      awayTotalOverall++;
      awayTotalSpecific++;
      if (checkOutcome(parsed, m, 'away', trackAway)) {
        awayHitsOverall++;
        awayHitsSpecific++;
      }
    } else if (m.home_team?.toLowerCase() === awayTeam?.toLowerCase()) {
      awayTotalOverall++;
      if (checkOutcome(parsed, m, 'home', trackAway)) awayHitsOverall++;
    }
  }

  // --- Arbitro ---
  let refTotal = 0, refHits = 0;
  const refRelevant = referee && (parsed.stat === 'falli' || parsed.stat === 'cartellini');
  if (refRelevant) {
    let refTrack = parsed.scope === 'totale' ? 'totale'
      : parsed.scope === 'casa' ? 'made'
      : 'made';

    for (const m of matchesBefore) {
      if (m.referee?.toLowerCase() === referee?.toLowerCase()) {
        refTotal++;
        const condScope = parsed.scope === 'totale'
          ? checkOutcome(parsed, m, 'home', 'totale')
          : parsed.scope === 'casa'
            ? checkOutcome(parsed, m, 'home', 'made')
            : checkOutcome(parsed, m, 'away', 'made');
        if (condScope) refHits++;
      }
    }
  }

  // Usiamo le "Specifiche" per il calcolo del punteggio principale, in quanto performano meglio
  const homePct = homeTotalSpecific >= MIN_SAMPLE_TEAM ? homeHitsSpecific / homeTotalSpecific : null;
  const awayPct = awayTotalSpecific >= MIN_SAMPLE_TEAM ? awayHitsSpecific / awayTotalSpecific : null;
  const refPct  = (refRelevant && refTotal >= MIN_SAMPLE_REF) ? refHits / refTotal : null;
  const hasRef  = refPct !== null;

  const homePctOverall = homeTotalOverall >= MIN_SAMPLE_TEAM ? Math.round((homeHitsOverall / homeTotalOverall) * 1000) / 1000 : null;
  const awayPctOverall = awayTotalOverall >= MIN_SAMPLE_TEAM ? Math.round((awayHitsOverall / awayTotalOverall) * 1000) / 1000 : null;

  const histScore = calcHistScore(homePct, awayPct, homePctOverall, awayPctOverall, refPct, hasRef);

  return {
    homePct: homePct !== null ? Math.round(homePct * 1000) / 1000 : null, // Retrocompatibilità
    homeSample: homeTotalSpecific,
    homePctOverall,
    homeSampleOverall: homeTotalOverall,
    
    awayPct: awayPct !== null ? Math.round(awayPct * 1000) / 1000 : null, // Retrocompatibilità
    awaySample: awayTotalSpecific,
    awayPctOverall,
    awaySampleOverall: awayTotalOverall,
    
    refPct: refPct !== null ? Math.round(refPct * 1000) / 1000 : null,
    refSample: refTotal,
    hasRef,
    histScore,
  };
}

/**
 * calcFormSummary — Stato di forma (ultime N partite specifiche)
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string|null} referee
 * @param {string} betName
 * @param {Array} matchesBefore — partite filtrate per data < match_date
 * @param {number} N — numero di partite da considerare (default 5)
 * @returns {object}
 */
export function calcFormSummary(homeTeam, awayTeam, referee, betName, matchesBefore, N = 5) {
  const parsed = parseMarketName(betName);
  if (!parsed) return null;

  const { trackHome, trackAway } = getTrackTypes(parsed);

  // Ordina per data decrescente (più recente prima)
  const sorted = [...matchesBefore].sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    return db - da;
  });

  // --- GENERALI ---
  const homeGenMatches = sorted
    .filter(m => m.home_team?.toLowerCase() === homeTeam?.toLowerCase() || m.away_team?.toLowerCase() === homeTeam?.toLowerCase())
    .slice(0, N);
  const awayGenMatches = sorted
    .filter(m => m.home_team?.toLowerCase() === awayTeam?.toLowerCase() || m.away_team?.toLowerCase() === awayTeam?.toLowerCase())
    .slice(0, N);

  const homeGenHits = homeGenMatches.filter(m => checkOutcome(parsed, m, m.home_team?.toLowerCase() === homeTeam?.toLowerCase() ? 'home' : 'away', trackHome)).length;
  const awayGenHits = awayGenMatches.filter(m => checkOutcome(parsed, m, m.home_team?.toLowerCase() === awayTeam?.toLowerCase() ? 'home' : 'away', trackAway)).length;

  // --- SPECIFICHE ---
  // Ultime N partite in casa per homeTeam
  const homeMatches = sorted
    .filter(m => m.home_team?.toLowerCase() === homeTeam?.toLowerCase())
    .slice(0, N);

  // Ultime N partite in trasferta per awayTeam
  const awayMatches = sorted
    .filter(m => m.away_team?.toLowerCase() === awayTeam?.toLowerCase())
    .slice(0, N);

  const homeHits = homeMatches.filter(m => checkOutcome(parsed, m, 'home', trackHome)).length;
  const awayHits = awayMatches.filter(m => checkOutcome(parsed, m, 'away', trackAway)).length;

  // Arbitro: ultime N partite dirette
  let refMatches = [];
  let refHits = 0;
  const refRelevant = referee && (parsed.stat === 'falli' || parsed.stat === 'cartellini');
  if (refRelevant) {
    refMatches = sorted
      .filter(m => m.referee?.toLowerCase() === referee?.toLowerCase())
      .slice(0, N);

    refHits = refMatches.filter(m => {
      const condScope = parsed.scope === 'totale'
        ? checkOutcome(parsed, m, 'home', 'totale')
        : parsed.scope === 'casa'
          ? checkOutcome(parsed, m, 'home', 'made')
          : checkOutcome(parsed, m, 'away', 'made');
      return condScope;
    }).length;
  }

  return {
    N,
    // Form Specific (Retrocompatibile)
    homeN: homeMatches.length,
    homeFormHits: homeHits,
    homeFormPct: homeMatches.length > 0 ? Math.round((homeHits / homeMatches.length) * 1000) / 1000 : null,
    
    // Form Generale
    homeGenN: homeGenMatches.length,
    homeGenFormHits: homeGenHits,
    homeGenFormPct: homeGenMatches.length > 0 ? Math.round((homeGenHits / homeGenMatches.length) * 1000) / 1000 : null,

    // Form Specific (Retrocompatibile)
    awayN: awayMatches.length,
    awayFormHits: awayHits,
    awayFormPct: awayMatches.length > 0 ? Math.round((awayHits / awayMatches.length) * 1000) / 1000 : null,
    
    // Form Generale
    awayGenN: awayGenMatches.length,
    awayGenFormHits: awayGenHits,
    awayGenFormPct: awayGenMatches.length > 0 ? Math.round((awayGenHits / awayGenMatches.length) * 1000) / 1000 : null,

    refN: refMatches.length,
    refFormHits: refHits,
    refFormPct: refMatches.length > 0 ? Math.round((refHits / refMatches.length) * 1000) / 1000 : null,
    hasRef: refRelevant && refMatches.length >= MIN_SAMPLE_REF,
  };
}

/**
 * calcFormScore — Formula aggregata della forma
 * Media pura di tutti i parametri disponibili
 */
export function calcFormScore(form) {
  if (!form) return null;
  const parts = [];
  if (form.homeFormPct !== null && form.homeFormPct !== undefined) parts.push(form.homeFormPct);
  if (form.awayFormPct !== null && form.awayFormPct !== undefined) parts.push(form.awayFormPct);
  if (form.homeGenFormPct !== null && form.homeGenFormPct !== undefined) parts.push(form.homeGenFormPct);
  if (form.awayGenFormPct !== null && form.awayGenFormPct !== undefined) parts.push(form.awayGenFormPct);
  
  if (parts.length === 0) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(avg * 1000) / 1000;
}

/**
 * calcHistScore — Formula pesi per hist_score aggregato
 *
 * Media pura di tutti i parametri disponibili (Casa Spec, Trasf Spec, Casa Gen, Trasf Gen, [Arbitro])
 *
 * @returns {number|null} valore tra 0 e 1, o null se nessun dato disponibile
 */
export function calcHistScore(homePct, awayPct, homePctOverall, awayPctOverall, refPct, hasRef) {
  const parts = [];
  if (homePct !== null) parts.push(homePct);
  if (awayPct !== null) parts.push(awayPct);
  if (homePctOverall !== null) parts.push(homePctOverall);
  if (awayPctOverall !== null) parts.push(awayPctOverall);
  if (hasRef && refPct !== null) parts.push(refPct);
  
  if (parts.length === 0) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(avg * 1000) / 1000;
}

/**
 * isSniperElite — Verifica se la scommessa supera il filtro severo combinato:
 * Forma: Media > 70% & Tutti i parametri >= 60%
 * Storico: Media > 70% & Tutti i parametri >= 60%
 */
export function isSniperElite(hist, form) {
  if (!hist || !form) return false;

  // 1. Check Forma
  if (form.homeFormPct === null || form.awayFormPct === null || form.homeGenFormPct === null || form.awayGenFormPct === null) return false;
  const formAvg = (form.homeFormPct + form.awayFormPct + form.homeGenFormPct + form.awayGenFormPct) / 4;
  if (formAvg <= 0.70) return false;
  if (form.homeFormPct < 0.60 || form.awayFormPct < 0.60 || form.homeGenFormPct < 0.60 || form.awayGenFormPct < 0.60) return false;

  // 2. Check Storico
  if (hist.homePct === null || hist.awayPct === null || hist.homePctOverall === null || hist.awayPctOverall === null) return false;
  
  const hasRef = hist.refPct !== null && hist.refPct !== undefined;
  
  if (hasRef) {
    const histAvg = (hist.homePct + hist.awayPct + hist.homePctOverall + hist.awayPctOverall + hist.refPct) / 5;
    if (histAvg <= 0.70) return false;
    if (hist.homePct < 0.60 || hist.awayPct < 0.60 || hist.homePctOverall < 0.60 || hist.awayPctOverall < 0.60 || hist.refPct < 0.60) return false;
  } else {
    const histAvg = (hist.homePct + hist.awayPct + hist.homePctOverall + hist.awayPctOverall) / 4;
    if (histAvg <= 0.70) return false;
    if (hist.homePct < 0.60 || hist.awayPct < 0.60 || hist.homePctOverall < 0.60 || hist.awayPctOverall < 0.60) return false;
  }

  return true;
}
