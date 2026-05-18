import { NextResponse } from 'next/server';
import https from 'https';

// ─── Team name mapping (identico a collect_sofascore.js) ─────────────────────
const TEAM_MAPPING = {
  'amburgo': 'hamburger sv', 'ath bilbao': 'athletic club',
  'ath madrid': 'atlético madrid', 'bayern': 'bayern münchen',
  'betis': 'real betis', 'dortmund': 'borussia dortmund',
  'ein frankfurt': 'eintracht frankfurt', 'espanol': 'espanyol',
  'fc koln': '1. fc köln', 'forest': 'nottingham forest',
  'friburgo': 'sc freiburg', 'heidenheim': '1. fc heidenheim',
  'leverkusen': 'bayer 04 leverkusen',
  "m'gladbach": 'borussia mönchengladbach',
  "borussia m'gladbach": 'borussia mönchengladbach',
  'man city': 'manchester city', 'man united': 'manchester united',
  'psg': 'paris saint-germain', 'sociedad': 'real sociedad',
  'st pauli': 'st. pauli', 'vallecano': 'rayo vallecano',
  'wolves': 'wolverhampton', 'rennes': 'stade rennais',
  'union berlin': '1. fc union berlin', 'mainz': '1. fsv mainz 05',
  'hoffenheim': 'tsg hoffenheim', 'celta': 'celta vigo',
  'alaves': 'deportivo alavés', 'auxerre': 'aj auxerre',
  'brest': 'stade brestois', 'brighton': 'brighton & hove albion',
  'le havre': 'le havre', 'leeds': 'leeds united', 'lens': 'rc lens',
  'lyon': 'olympique lyonnais', 'marseille': 'olympique de marseille',
  'metz': 'fc metz', 'monaco': 'as monaco', 'nantes': 'fc nantes',
  'newcastle': 'newcastle united', 'nice': 'ogc nice',
  'osasuna': 'ca osasuna', 'strasbourg': 'rc strasbourg',
  'stuttgart': 'vfb stuttgart', 'tottenham': 'tottenham hotspur',
  'toulouse': 'toulouse', 'west ham': 'west ham united',
};

function normalizeTeamName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  if (TEAM_MAPPING[n]) n = TEAM_MAPPING[n];
  return n
    .replace(/fc\s+|ac\s+|as\s+|ss\s+|\s+fc|\s+calcio/g, '')
    .replace(/internazionale|inter milan/, 'inter')
    .replace(/hellas verona/, 'verona')
    .replace(/athletic club/, 'athletic bilbao')
    .trim();
}

function getSimilarity(s1, s2) {
  let longer = s1, shorter = s2;
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  const ll = longer.length;
  if (ll === 0) return 1.0;
  if (longer.includes(shorter)) return 0.9;
  const costs = [];
  for (let i = 0; i <= ll; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) { costs[j] = j; }
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (ll - costs[shorter.length]) / parseFloat(ll);
}

function matchTeam(dbName, sofaName) {
  const a = normalizeTeamName(dbName);
  const b = normalizeTeamName(sofaName);
  return a === b || getSimilarity(a, b) > 0.75;
}

// ─── SofaScore API fetcher (https nativo — stesso trick del backfill) ─────────
async function fetchJson(url) {
  // Se siamo su Vercel, deleghiamo la richiesta al servizio locale via ngrok
  const scraperUrl = process.env.SCRAPER_SERVICE_URL;
  if (scraperUrl) {
    console.log(`[SofaFetch] PROXY tramite scraper-service: ${url}`);
    const proxyUrl = `${scraperUrl.replace(/\/$/, '')}/proxy-sofascore?url=${encodeURIComponent(url)}`;
    try {
      const res = await fetch(proxyUrl, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) {
        console.error(`[SofaFetch] ❌ Proxy ha risposto ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[SofaFetch] ❌ Errore Proxy: ${e.message}`);
      return null;
    }
  }

  // Fallback (locale)
  return new Promise((resolve) => {
    console.log(`[SofaFetch] GET Locale ${url}`);
    const options = {
      agent: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.sofascore.com/',
        'Origin': 'https://www.sofascore.com',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    };
    https.get(url, options, (res) => {
      console.log(`[SofaFetch] Status: ${res.statusCode} for ${url}`);
      if (res.statusCode !== 200) {
        console.error(`[SofaFetch] ❌ Non-200 status ${res.statusCode} — resolving null`);
        return resolve(null);
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.error(`[SofaFetch] ❌ JSON parse error: ${e.message}`);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.error(`[SofaFetch] ❌ Network error: ${e.message}`);
      resolve(null);
    });
  });
}

function extractValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string' && val.includes('%')) return parseFloat(val.replace('%', ''));
  return parseFloat(val);
}

function parseStatistics(statisticsArray) {
  const result = { ALL: { home: {}, away: {} }, '1ST': { home: {}, away: {} } };
  if (!statisticsArray) return result;
  for (const period of statisticsArray) {
    const pName = period.period;
    if (pName !== 'ALL' && pName !== '1ST') continue;
    for (const group of period.groups) {
      for (const item of group.statisticsItems) {
        const validKeys = [
          'expectedGoals', 'cornerKicks', 'yellowCards', 'redCards',
          'offsides', 'insideBoxShots', 'bigChanceCreated', 'ballPossession',
          'shotsOnTarget', 'shots', 'fouls', 'saves',
        ];
        if (validKeys.includes(item.key)) {
          result[pName].home[item.key] = extractValue(item.homeValue);
          result[pName].away[item.key] = extractValue(item.awayValue);
        }
      }
    }
  }
  return result;
}

// ─── POST /api/sofascore-fetch ────────────────────────────────────────────────
export async function POST(request) {
  try {
    const { home_team, away_team, date } = await request.json();
    console.log(`\n[SofaFetch] ═══════════════════════════════════════`);
    console.log(`[SofaFetch] Richiesta: "${home_team}" vs "${away_team}" del ${date}`);
    console.log(`[SofaFetch] Norm casa: "${normalizeTeamName(home_team)}" | Norm ospite: "${normalizeTeamName(away_team)}"`);

    if (!home_team || !away_team || !date) {
      return NextResponse.json({ error: 'Parametri mancanti: home_team, away_team, date' }, { status: 400 });
    }

    // 1. Scarica l'elenco degli eventi SofaScore per la data
    const eventsData = await fetchJson(
      `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`
    );

    if (!eventsData?.events) {
      console.error(`[SofaFetch] ❌ Nessun evento nella risposta API per ${date}. eventsData: ${JSON.stringify(eventsData)?.slice(0,200)}`);
      return NextResponse.json({ error: `Nessun evento trovato su SofaScore per il ${date}` }, { status: 404 });
    }

    const allEvents = eventsData.events;
    const finishedEvents = allEvents.filter((e) => e.status?.type === 'finished');
    console.log(`[SofaFetch] Totale eventi: ${allEvents.length}, di cui conclusi: ${finishedEvents.length}`);
    console.log(`[SofaFetch] Partite concluse trovate:`);
    finishedEvents.forEach(e => {
      console.log(`  - "${e.homeTeam.name}" vs "${e.awayTeam.name}" (norm: "${normalizeTeamName(e.homeTeam.name)}" vs "${normalizeTeamName(e.awayTeam.name)}")`);
    });

    // 2. Cerca la partita corrispondente con fuzzy matching
    let sofaEvent = null;
    for (const e of finishedEvents) {
      const homeNorm = normalizeTeamName(e.homeTeam.name);
      const awayNorm = normalizeTeamName(e.awayTeam.name);
      const reqHomeNorm = normalizeTeamName(home_team);
      const reqAwayNorm = normalizeTeamName(away_team);
      const homeScore = getSimilarity(reqHomeNorm, homeNorm);
      const awayScore = getSimilarity(reqAwayNorm, awayNorm);
      const homeMatch = homeScore > 0.75 || homeNorm.includes(reqHomeNorm) || reqHomeNorm.includes(homeNorm);
      const awayMatch = awayScore > 0.75 || awayNorm.includes(reqAwayNorm) || reqAwayNorm.includes(awayNorm);
      if (homeMatch && awayMatch) {
        console.log(`[SofaFetch] ✅ MATCH trovato: "${e.homeTeam.name}" vs "${e.awayTeam.name}" (score: ${homeScore.toFixed(2)} / ${awayScore.toFixed(2)})`);
        sofaEvent = e;
        break;
      } else {
        console.log(`[SofaFetch]   skip "${e.homeTeam.name}" vs "${e.awayTeam.name}" — home: ${homeScore.toFixed(2)} (ok:${homeMatch}), away: ${awayScore.toFixed(2)} (ok:${awayMatch})`);
      }
    }

    if (!sofaEvent) {
      console.warn(`[SofaFetch] ⚠️  Match non trovato in ${date}. Provo data successiva...`);
      // Prova anche date adiacenti (partite notturne / fuso orario)
      const altDate = new Date(date + 'T12:00:00Z');
      altDate.setUTCDate(altDate.getUTCDate() + 1);
      const altDateStr = altDate.toISOString().split('T')[0];
      console.log(`[SofaFetch] Controllo data alternativa: ${altDateStr}`);
      const altEventsData = await fetchJson(
        `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${altDateStr}`
      );
      const altFinished = (altEventsData?.events || []).filter((e) => e.status?.type === 'finished');
      console.log(`[SofaFetch] Data alt — concluse: ${altFinished.length}`);
      altFinished.forEach(e => console.log(`  - "${e.homeTeam.name}" vs "${e.awayTeam.name}"` ));

      for (const e of altFinished) {
        if (matchTeam(home_team, e.homeTeam.name) && matchTeam(away_team, e.awayTeam.name)) {
          console.log(`[SofaFetch] ✅ MATCH trovato in data alternativa!`);
          sofaEvent = e;
          break;
        }
      }

      if (!sofaEvent) {
        console.error(`[SofaFetch] ❌ Partita non trovata né in ${date} né in ${altDateStr}`);
        return NextResponse.json({
          error: `Partita "${home_team} vs ${away_team}" non trovata su SofaScore per il ${date}`,
          hint: 'Verifica i nomi delle squadre o la data',
          debug: {
            searchedDate: date,
            altDate: altDateStr,
            normalizedRequest: { home: normalizeTeamName(home_team), away: normalizeTeamName(away_team) },
            finishedGamesOnDate: finishedEvents.map(e => `${e.homeTeam.name} vs ${e.awayTeam.name}`),
          }
        }, { status: 404 });
      }
    }

    return await fetchStatsAndRespond(sofaEvent);

  } catch (err) {
    console.error(`[SofaFetch] ❌ Eccezione: ${err.message}`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function fetchStatsAndRespond(sofaEvent) {
  // 3. Scarica le statistiche dettagliate
  console.log(`[SofaFetch] Fetching stats per event ID: ${sofaEvent.id}`);
  const statsData = await fetchJson(
    `https://api.sofascore.com/api/v1/event/${sofaEvent.id}/statistics`
  );

  if (!statsData?.statistics) {
    console.warn(`[SofaFetch] ⚠️  Nessuna statistica disponibile per l'evento ${sofaEvent.id}`);
  }

  const s = parseStatistics(statsData?.statistics);
  const A = s['ALL'];
  const H = s['1ST'];

  // 4. Costruisce il payload completo
  const result = {
    sofaId: sofaEvent.id,
    sofaHomeName: sofaEvent.homeTeam.name,
    sofaAwayName: sofaEvent.awayTeam.name,

    // ── Campi visibili nel form (16) ─────────────────────────────────────────
    home_goals:   sofaEvent.homeScore?.current ?? null,
    away_goals:   sofaEvent.awayScore?.current ?? null,
    home_shots:   A.home.shots ?? null,
    away_shots:   A.away.shots ?? null,
    home_sot:     A.home.shotsOnTarget ?? null,
    away_sot:     A.away.shotsOnTarget ?? null,
    home_fouls:   A.home.fouls ?? null,
    away_fouls:   A.away.fouls ?? null,
    home_corners: A.home.cornerKicks ?? null,
    away_corners: A.away.cornerKicks ?? null,
    home_yellows: A.home.yellowCards ?? null,
    away_yellows: A.away.yellowCards ?? null,
    home_reds:    A.home.redCards ?? null,
    away_reds:    A.away.redCards ?? null,
    home_saves:   A.home.saves ?? null,
    away_saves:   A.away.saves ?? null,

    // ── Campi SofaScore silenzioso (20) ─────────────────────────────────────
    home_xg:               A.home.expectedGoals ?? null,
    away_xg:               A.away.expectedGoals ?? null,
    home_xg_ht:            H.home.expectedGoals ?? null,
    away_xg_ht:            H.away.expectedGoals ?? null,
    home_goals_ht:         sofaEvent.homeScore?.period1 ?? null,
    away_goals_ht:         sofaEvent.awayScore?.period1 ?? null,
    home_corners_ht:       H.home.cornerKicks ?? null,
    away_corners_ht:       H.away.cornerKicks ?? null,
    home_yellows_ht:       H.home.yellowCards ?? null,
    away_yellows_ht:       H.away.yellowCards ?? null,
    home_reds_ht:          H.home.redCards ?? null,
    away_reds_ht:          H.away.redCards ?? null,
    home_offsides:         A.home.offsides ?? null,
    away_offsides:         A.away.offsides ?? null,
    home_shots_insidebox:  A.home.insideBoxShots ?? null,
    away_shots_insidebox:  A.away.insideBoxShots ?? null,
    home_big_chances:      A.home.bigChanceCreated ?? null,
    away_big_chances:      A.away.bigChanceCreated ?? null,
    home_possession:       A.home.ballPossession ?? null,
    away_possession:       A.away.ballPossession ?? null,
  };

  // Log completo di tutti i 36 campi
  console.log(`[SofaFetch] ✅ Risultato completo per ${result.sofaHomeName} vs ${result.sofaAwayName}:`);
  console.log(`  [VISIBILI] Gol: ${result.home_goals}-${result.away_goals} | Tiri: ${result.home_shots}-${result.away_shots} | SOT: ${result.home_sot}-${result.away_sot}`);
  console.log(`  [VISIBILI] Falli: ${result.home_fouls}-${result.away_fouls} | Corner: ${result.home_corners}-${result.away_corners}`);
  console.log(`  [VISIBILI] Gialli: ${result.home_yellows}-${result.away_yellows} | Rossi: ${result.home_reds}-${result.away_reds} | Parate: ${result.home_saves}-${result.away_saves}`);
  console.log(`  [SOFA]     xG: ${result.home_xg}-${result.away_xg} | xG HT: ${result.home_xg_ht}-${result.away_xg_ht}`);
  console.log(`  [SOFA]     Gol HT: ${result.home_goals_ht}-${result.away_goals_ht} | Corner HT: ${result.home_corners_ht}-${result.away_corners_ht}`);
  console.log(`  [SOFA]     Gialli HT: ${result.home_yellows_ht}-${result.away_yellows_ht} | Rossi HT: ${result.home_reds_ht}-${result.away_reds_ht}`);
  console.log(`  [SOFA]     Fuorigioco: ${result.home_offsides}-${result.away_offsides} | Tiri in area: ${result.home_shots_insidebox}-${result.away_shots_insidebox}`);
  console.log(`  [SOFA]     Grandi occ.: ${result.home_big_chances}-${result.away_big_chances} | Possesso: ${result.home_possession}%-${result.away_possession}%`);
  console.log(`[SofaFetch] ═══════════════════════════════════════\n`);

  return NextResponse.json({ success: true, data: result });
}
