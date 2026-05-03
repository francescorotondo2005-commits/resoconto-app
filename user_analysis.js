const fs = require('fs');
const { createClient } = require('@libsql/client');
const { calcHistorySummary, calcFormSummary } = require('./lib/history');

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) acc[match[1]] = match[2].trim();
  return acc;
}, {});

// Helper per calcolare lo storico totale (senza filtro casa/trasferta)
function getTrackTypes(parsed) {
  let trackHome = 'totale';
  let trackAway = 'totale';
  if (parsed.scope === 'casa') { trackHome = 'made'; trackAway = 'conceded'; } 
  else if (parsed.scope === 'ospite') { trackHome = 'conceded'; trackAway = 'made'; } 
  else if (parsed.type === '1x2') {
    if (parsed.esito === '1') { trackHome = 'made'; trackAway = 'conceded'; }
    else if (parsed.esito === '2') { trackHome = 'conceded'; trackAway = 'made'; }
  }
  return { trackHome, trackAway };
}

function checkOutcome(parsed, match, teamRole, trackType) {
  const { getMatchStatValue } = require('./lib/grading.js');
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

// Calcola sia Overall che Specific (Home/Away)
function calcAdvancedHistory(homeTeam, awayTeam, referee, betName, matchesBefore) {
  const { parseMarketName } = require('./lib/grading.js');
  const parsed = parseMarketName(betName);
  if (!parsed) return null;
  const { trackHome, trackAway } = getTrackTypes(parsed);

  // Home Team Stats
  let homeTotalOverall = 0, homeHitsOverall = 0;
  let homeTotalSpecific = 0, homeHitsSpecific = 0;
  
  for (const m of matchesBefore) {
    if (m.home_team === homeTeam) {
      homeTotalOverall++;
      homeTotalSpecific++;
      if (checkOutcome(parsed, m, 'home', trackHome)) {
        homeHitsOverall++;
        homeHitsSpecific++;
      }
    } else if (m.away_team === homeTeam) {
      homeTotalOverall++;
      if (checkOutcome(parsed, m, 'away', trackHome)) { // Se gioca fuori, il suo teamRole è 'away'
        homeHitsOverall++;
      }
    }
  }

  // Away Team Stats
  let awayTotalOverall = 0, awayHitsOverall = 0;
  let awayTotalSpecific = 0, awayHitsSpecific = 0;

  for (const m of matchesBefore) {
    if (m.away_team === awayTeam) {
      awayTotalOverall++;
      awayTotalSpecific++;
      if (checkOutcome(parsed, m, 'away', trackAway)) {
        awayHitsOverall++;
        awayHitsSpecific++;
      }
    } else if (m.home_team === awayTeam) {
      awayTotalOverall++;
      if (checkOutcome(parsed, m, 'home', trackAway)) {
        awayHitsOverall++;
      }
    }
  }

  return {
    homePctSpecific: homeTotalSpecific > 0 ? homeHitsSpecific / homeTotalSpecific : null,
    homePctOverall: homeTotalOverall > 0 ? homeHitsOverall / homeTotalOverall : null,
    awayPctSpecific: awayTotalSpecific > 0 ? awayHitsSpecific / awayTotalSpecific : null,
    awayPctOverall: awayTotalOverall > 0 ? awayHitsOverall / awayTotalOverall : null,
    scope: parsed.scope
  };
}

// Calcola Forma basata sulle ultime 5 GENERALI vs Ultime 5 SPECIFICHE
function calcAdvancedForm(homeTeam, awayTeam, referee, betName, matchesBefore, N=5) {
  const { parseMarketName } = require('./lib/grading.js');
  const parsed = parseMarketName(betName);
  if (!parsed) return null;
  const { trackHome, trackAway } = getTrackTypes(parsed);

  const sorted = [...matchesBefore].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Ultime N GENERALI
  const homeGen = sorted.filter(m => m.home_team === homeTeam || m.away_team === homeTeam).slice(0, N);
  const awayGen = sorted.filter(m => m.home_team === awayTeam || m.away_team === awayTeam).slice(0, N);

  let homeGenHits = 0;
  for (const m of homeGen) {
    const role = m.home_team === homeTeam ? 'home' : 'away';
    if (checkOutcome(parsed, m, role, trackHome)) homeGenHits++;
  }

  let awayGenHits = 0;
  for (const m of awayGen) {
    const role = m.home_team === awayTeam ? 'home' : 'away';
    if (checkOutcome(parsed, m, role, trackAway)) awayGenHits++;
  }

  // Ultime N SPECIFICHE
  const homeSpec = sorted.filter(m => m.home_team === homeTeam).slice(0, N);
  const awaySpec = sorted.filter(m => m.away_team === awayTeam).slice(0, N);

  let homeSpecHits = homeSpec.filter(m => checkOutcome(parsed, m, 'home', trackHome)).length;
  let awaySpecHits = awaySpec.filter(m => checkOutcome(parsed, m, 'away', trackAway)).length;

  return {
    homeGenPct: homeGen.length > 0 ? homeGenHits / homeGen.length : null,
    awayGenPct: awayGen.length > 0 ? awayGenHits / awayGen.length : null,
    homeSpecPct: homeSpec.length > 0 ? homeSpecHits / homeSpec.length : null,
    awaySpecPct: awaySpec.length > 0 ? awaySpecHits / awaySpec.length : null,
  };
}

async function run() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  
  const res = await db.execute("SELECT * FROM backtest_bets ORDER BY match_date ASC");
  const bets = res.rows;
  
  const mRes = await db.execute("SELECT * FROM matches ORDER BY date ASC");
  const allMatches = mRes.rows;

  console.log("\n--- ANALISI SULLE SCOMMESSE DELL'UTENTE ---");
  const userBets = [
    "Inter - Parma|OVER 6,5 TIRI OSPITE",
    "Espanol - Real Madrid|UNDER 16,5 TIRI OSPITE",
    "Freiburg - Wolfsburg|UNDER 4,5 CORNER OSPITE",
    "Freiburg - Wolfsburg|1X2 TIRI IN PORTA: 1",
    "Juventus - Verona|UNDER 19,5 TIRI CASA",
    "M'gladbach - Dortmund|UNDER 5,5 CORNER OSPITE",
    "Getafe - Vallecano|UNDER 5,5 CARTELLINI TOTALI",
    "Osasuna - Barcelona|OVER 1,5 CARTELLINI OSPITE",
    "Metz - Monaco|OVER 10,5 TIRI CASA",
    "Valencia - Ath Madrid|OVER 3,5 CARTELLINI TOTALI"
  ];

  for (const ub of userBets) {
    const [matchStr, betName] = ub.split('|');
    const [homeTeam, awayTeam] = matchStr.split(' - ');
    
    // Trova la scommessa nel db
    const bet = bets.find(b => b.bet_name === betName && b.match_key.includes(matchStr));
    if (!bet) {
      console.log(`Non trovata nel DB: ${ub}`);
      continue;
    }
    
    const [, bHome, bAway] = bet.match_key.split('|');
    const matchesBefore = allMatches.filter(m => m.league === bet.match_key.split('|')[0] && m.date < bet.match_date);
    
    const hist = calcAdvancedHistory(bHome, bAway, null, bet.bet_name, matchesBefore);
    const form = calcAdvancedForm(bHome, bAway, null, bet.bet_name, matchesBefore, 5);

    if (hist && form) {
      console.log(`\nPartita: ${matchStr} | Scommessa: ${betName} | Esito: ${bet.outcome}`);
      console.log(`STORICO (${hist.scope}):`);
      console.log(`  Casa:  Overall ${(hist.homePctOverall*100).toFixed(0)}% | Solo in Casa ${(hist.homePctSpecific*100).toFixed(0)}%`);
      console.log(`  Ospite: Overall ${(hist.awayPctOverall*100).toFixed(0)}% | Solo in Trasferta ${(hist.awayPctSpecific*100).toFixed(0)}%`);
      console.log(`FORMA (Ultime 5):`);
      console.log(`  Casa:  Generale ${(form.homeGenPct*100).toFixed(0)}% | Solo in Casa ${(form.homeSpecPct*100).toFixed(0)}%`);
      console.log(`  Ospite: Generale ${(form.awayGenPct*100).toFixed(0)}% | Solo in Trasferta ${(form.awaySpecPct*100).toFixed(0)}%`);
    }
  }

  const thresholds = [0.60, 0.65, 0.70, 0.75, 0.80];

  console.log("\n--- TEST STORICO: STATICO VS DINAMICO ---");
  for (const th of thresholds) {
    let statW = 0, statT = 0, statP = 0;
    let dynW = 0, dynT = 0, dynP = 0;

    for (const b of bets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      if (b.best_edge < 0.28 || b.probability < 0.60) continue;

      const [, bHome, bAway] = b.match_key.split('|');
      const matchesBefore = allMatches.filter(m => m.league === b.match_key.split('|')[0] && m.date < b.match_date);
      const hist = calcAdvancedHistory(bHome, bAway, null, b.bet_name, matchesBefore);
      if (!hist) continue;

      const odds = Math.max(b.sportium || 1, b.sportbet || 1);
      const isWin = b.outcome === 'WIN';

      let staticScore = null;
      if (hist.homePctSpecific !== null && hist.awayPctSpecific !== null) {
        staticScore = (hist.homePctSpecific + hist.awayPctSpecific) / 2;
      }
      
      let dynamicScore = null;
      if (hist.homePctSpecific !== null && hist.awayPctSpecific !== null) {
        if (hist.scope === 'casa') dynamicScore = (hist.homePctSpecific * 0.7) + (hist.awayPctSpecific * 0.3);
        else if (hist.scope === 'ospite') dynamicScore = (hist.homePctSpecific * 0.3) + (hist.awayPctSpecific * 0.7);
        else dynamicScore = (hist.homePctSpecific + hist.awayPctSpecific) / 2;
      }

      if (staticScore !== null && staticScore >= th) {
        statT++; if (isWin) { statW++; statP += (odds - 1); } else { statP -= 1; }
      }
      if (dynamicScore !== null && dynamicScore >= th) {
        dynT++; if (isWin) { dynW++; dynP += (odds - 1); } else { dynP -= 1; }
      }
    }
    console.log(`Threshold > ${(th*100).toFixed(0)}% | Statico: Bets ${statT}, HR ${(statT>0?statW/statT*100:0).toFixed(1)}%, Yield ${(statT>0?statP/statT*100:0).toFixed(1)}% | Dinamico: Bets ${dynT}, HR ${(dynT>0?dynW/dynT*100:0).toFixed(1)}%, Yield ${(dynT>0?dynP/dynT*100:0).toFixed(1)}%`);
  }

  console.log("\n--- TEST FORMA: SPECIFICA VS GENERALE ---");
  for (const th of thresholds) {
    let specW = 0, specT = 0, specP = 0;
    let genW = 0, genT = 0, genP = 0;

    for (const b of bets) {
      if (b.outcome !== 'WIN' && b.outcome !== 'LOSS') continue;
      if (b.best_edge < 0.28 || b.probability < 0.60) continue;

      const [, bHome, bAway] = b.match_key.split('|');
      const matchesBefore = allMatches.filter(m => m.league === b.match_key.split('|')[0] && m.date < b.match_date);
      const form = calcAdvancedForm(bHome, bAway, null, b.bet_name, matchesBefore, 5);
      if (!form) continue;

      const odds = Math.max(b.sportium || 1, b.sportbet || 1);
      const isWin = b.outcome === 'WIN';

      let formSpecScore = null;
      if (form.homeSpecPct !== null && form.awaySpecPct !== null) {
        formSpecScore = (form.homeSpecPct + form.awaySpecPct) / 2;
      }
      let formGenScore = null;
      if (form.homeGenPct !== null && form.awayGenPct !== null) {
        formGenScore = (form.homeGenPct + form.awayGenPct) / 2;
      }

      if (formSpecScore !== null && formSpecScore >= th) {
        specT++; if (isWin) { specW++; specP += (odds - 1); } else { specP -= 1; }
      }
      if (formGenScore !== null && formGenScore >= th) {
        genT++; if (isWin) { genW++; genP += (odds - 1); } else { genP -= 1; }
      }
    }
    console.log(`Threshold > ${(th*100).toFixed(0)}% | Specifica(Casa/Trasf): Bets ${specT}, HR ${(specT>0?specW/specT*100:0).toFixed(1)}%, Yield ${(specT>0?specP/specT*100:0).toFixed(1)}% | Generale(Ovunque): Bets ${genT}, HR ${(genT>0?genW/genT*100:0).toFixed(1)}%, Yield ${(genT>0?genP/genT*100:0).toFixed(1)}%`);
  }

}

run().catch(console.error);
