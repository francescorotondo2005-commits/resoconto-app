/**
 * Parsing strings of market names to grade them automatically based on final match statistics.
 */

function parseLabel(label) {
  const lowered = label.toLowerCase();
  let scope = 'totale';
  if (lowered.includes(' casa')) scope = 'casa';
  else if (lowered.includes(' ospite')) scope = 'ospite';
  // Note: if neither 'casa' nor 'ospite', it's 'totale' (e.g. "GOL" or "TIRI TOTALI")

  let stat = '';
  if (lowered.startsWith('gol')) stat = 'gol';
  else if (lowered.startsWith('tiri in porta')) stat = 'tip';
  else if (lowered.startsWith('tiri')) stat = 'tiri';
  else if (lowered.startsWith('tip')) stat = 'tip'; // Fallback per legacy DB
  else if (lowered.startsWith('falli')) stat = 'falli';
  else if (lowered.startsWith('corner')) stat = 'corner';
  else if (lowered.startsWith('cartellini')) stat = 'cartellini';
  else if (lowered.startsWith('parate')) stat = 'parate';

  return { stat, scope };
}

export function parseMarketName(name) {
  if (!name) return null;

  // Cleanup: Remove "(Custom)" identifier if present in UI string (shouldn't be in DB, but just in case)
  const cleanName = name.replace(' (Custom)', '').trim();

  // Try 1X2
  // Es: "1X2 TIRI: 1"
  const match1x2 = cleanName.match(/^1X2 (.*): (1|X|2)$/);
  if (match1x2) {
    const label = match1x2[1].trim();
    const esito = match1x2[2];
    const { stat } = parseLabel(label);
    return { type: '1x2', stat, esito };
  }
  
  // Try OVER/UNDER
  // Es: "OVER 2,5 GOL CASA", "UNDER 6 CARTELLINI"
  const matchOu = cleanName.match(/^(OVER|UNDER) (\d+(?:,\d+)?) (.*)$/);
  if (matchOu) {
    const direction = matchOu[1].toLowerCase(); // "over" or "under"
    const line = parseFloat(matchOu[2].replace(',', '.'));
    const label = matchOu[3].trim();
    const { stat, scope } = parseLabel(label);
    return { type: 'over_under', direction, line, stat, scope };
  }
  
  return null;
}

export function getMatchStatValue(match, typeStat, scope) {
  if (!typeStat) return 0;

  const isCartellini = typeStat === 'cartellini';
  const isParate = typeStat === 'parate';

  let homeVal = 0;
  let awayVal = 0;

  if (isCartellini) {
    // 1 giallo = 1, 1 rosso = 2
    homeVal = Number(match.home_yellows) + (Number(match.home_reds) * 2);
    awayVal = Number(match.away_yellows) + (Number(match.away_reds) * 2);
  } else if (isParate) {
    // Parate = Tiri in porta subiti - Gol subiti
    // Parate Casa = Tiri In Porta Ospite - Gol Ospite
    homeVal = Math.max(0, Number(match.away_sot) - Number(match.away_goals));
    // Parate Ospite = Tiri In Porta Casa - Gol Casa
    awayVal = Math.max(0, Number(match.home_sot) - Number(match.home_goals));
  } else {
    const statMap = {
      'gol': { home: 'home_goals', away: 'away_goals' },
      'tiri': { home: 'home_shots', away: 'away_shots' },
      'tip': { home: 'home_sot', away: 'away_sot' },
      'falli': { home: 'home_fouls', away: 'away_fouls' },
      'corner': { home: 'home_corners', away: 'away_corners' },
    };
    if (statMap[typeStat]) {
      homeVal = Number(match[statMap[typeStat].home] || 0);
      awayVal = Number(match[statMap[typeStat].away] || 0);
    }
  }

  if (scope === 'casa') return homeVal;
  if (scope === 'ospite') return awayVal;
  return homeVal + awayVal; // totale
}

/**
 * Gradients a bet given its name and the final match statistics.
 * @returns 'WIN', 'LOSS', 'VOID', or 'PENDING' (if unable to parse)
 */
export function gradeBet(marketName, matchStats) {
  // Supporto per Multiple (Bet Builder)
  if (marketName.includes(' + ')) {
    const legs = marketName.split(' + ');
    let allWin = true;
    let anyPending = false;
    let anyVoid = false;

    for (const leg of legs) {
      const result = gradeBet(leg.trim(), matchStats); // Chiamata ricorsiva
      if (result === 'LOSS') {
        allWin = false;
        return 'LOSS'; // Una persa = Multipla persa
      }
      if (result === 'PENDING') anyPending = true;
      if (result === 'VOID') anyVoid = true;
    }

    if (anyPending) return 'PENDING';
    if (anyVoid && !allWin) return 'VOID'; // Gestione VOID in multipla - semplificato
    return 'WIN';
  }

  const parsed = parseMarketName(marketName);
  if (!parsed || !parsed.stat) return 'PENDING';
  
  if (parsed.type === 'over_under') {
    const actualValue = getMatchStatValue(matchStats, parsed.stat, parsed.scope);
    
    if (parsed.direction === 'over') {
      if (actualValue > parsed.line) return 'WIN';
      if (actualValue < parsed.line) return 'LOSS';
      return 'VOID'; 
    } else {
      if (actualValue < parsed.line) return 'WIN';
      if (actualValue > parsed.line) return 'LOSS';
      return 'VOID';
    }
  } else if (parsed.type === '1x2') {
    // For 1X2, scope is always 'totale' but we compare home vs away
    const homeVal = getMatchStatValue(matchStats, parsed.stat, 'casa');
    const awayVal = getMatchStatValue(matchStats, parsed.stat, 'ospite');
    
    let actualEsito = 'X';
    if (homeVal > awayVal) actualEsito = '1';
    else if (awayVal > homeVal) actualEsito = '2';

    return actualEsito === parsed.esito ? 'WIN' : 'LOSS';
  }
  
  return 'PENDING';
}
