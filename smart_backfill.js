/**
 * smart_backfill.js
 * 
 * Backfill SofaScore intelligente: processa MAX N match per sessione con delay
 * casuali per sembrare traffico umano. Da eseguire ogni giorno finché completato.
 * 
 * Uso:
 *   node smart_backfill.js           → processa max 30 match
 *   node smart_backfill.js --max 50  → processa max 50 match
 *   node smart_backfill.js --league ChampionsLeague → solo una lega
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import https from 'https';

// ── Config ────────────────────────────────────────────────────────────
const MAX_MATCHES_PER_SESSION = (() => {
  const idx = process.argv.indexOf('--max');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 30;
})();

const FILTER_LEAGUE = (() => {
  const idx = process.argv.indexOf('--league');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// Cookie Cloudflare da Chrome (copiare da DevTools → Application → Cookies → sofascore.com)
const CF_COOKIE = (() => {
  const idx = process.argv.indexOf('--cookie');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const IS_HEADFUL = process.argv.includes('--headful');

if (!CF_COOKIE) {
  console.warn('[WARN] Nessun cookie --cookie fornito. Se ottieni 403, copia cf_clearance da Chrome:');
  console.warn('       DevTools (F12) → Application → Cookies → sofascore.com → cf_clearance');
  console.warn('       Poi: node smart_backfill.js --cookie "cf_clearance=VALORE"\n');
}

// Delay random tra minMin e maxMin secondi (anti-ban)
const DELAY_MIN_MS = 25000;
const DELAY_MAX_MS = 45000;

// Priorità leghe: quelle europee per prime (quasi certamente hanno xG)
const LEAGUE_PRIORITY = [
  'ChampionsLeague', 'EuropaLeague', 'ConferenceLeague',
  'CoppaItalia', 'DFBPokal', 'CopaDelRey', 'EFLCup',
  'CoupeDeFrance', 'FACup'
];

const DB_PATH = path.join(process.cwd(), 'resoconto.db');

// ── Helpers ───────────────────────────────────────────────────────────
function getDbClient() {
  const envPath = path.join(process.cwd(), '.env.local');
  let url = `file:${DB_PATH}`;
  let authToken = undefined;
  if (fs.existsSync(envPath)) {
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      if (line.includes('=')) {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/"/g, '').replace(/\r/g, '');
      }
    }
    if (env.TURSO_DATABASE_URL) {
      url = env.TURSO_DATABASE_URL;
      authToken = env.TURSO_AUTH_TOKEN;
    }
  }

  // Sovrascrivi con variabili di ambiente reali (usate su GitHub Actions)
  if (process.env.TURSO_DATABASE_URL) {
    url = process.env.TURSO_DATABASE_URL.trim().replace(/['"]/g, '').replace(/\r?\n|\r/g, '');
    authToken = process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.trim().replace(/['"]/g, '').replace(/\r?\n|\r/g, '') : undefined;
    
    // Stampa di debug sicura per identificare discrepanze con i segreti di GitHub
    console.log(`  [DB Debug] URL: "${url.slice(0, 15)}...${url.slice(-10)}" (Lunghezza: ${url.length})`);
    if (authToken) {
      console.log(`  [DB Debug] Token: "${authToken.slice(0, 8)}...${authToken.slice(-8)}" (Lunghezza: ${authToken.length})`);
    } else {
      console.log('  [DB Debug] Token non fornito / UNDEFINED');
    }
  }

  return createClient({ url, authToken });
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => delay(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));

// Rotazione User-Agent per sembrare browser reali diversi
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];
let uaIndex = 0;
function getUA() {
  return USER_AGENTS[uaIndex++ % USER_AGENTS.length];
}

import { createSofaSession } from './lib/sofa_playwright.js';

let sofaSession = null;
async function fetchJson(url) {
  try {
    if (!sofaSession) {
      console.log('  [SofaScore] Inizializzazione sessione Playwright...');
      sofaSession = await createSofaSession(CF_COOKIE, IS_HEADFUL);
    }
    const res = await sofaSession.fetch(url);
    if (res && res.__error) {
      console.error(`  [ERR] Impossibile recuperare ${url}: HTTP ${res.status}`);
    }
    return res;
  } catch (err) {
    console.error(`  [ERR] Impossibile recuperare ${url}:`, err.message);
    return { __error: true, status: 500, message: err.message };
  }
}


function extractValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string' && val.includes('%')) return parseFloat(val);
  return parseFloat(val);
}

function parseStats(statsArray) {
  const r = { ALL: { home: {}, away: {} }, '1ST': { home: {}, away: {} } };
  if (!statsArray) return r;
  for (const period of statsArray) {
    const p = period.period;
    if (p !== 'ALL' && p !== '1ST') continue;
    for (const group of period.groups) {
      for (const item of group.statisticsItems) {
        const validKeys = ['expectedGoals','cornerKicks','yellowCards','redCards',
          'offsides','insideBoxShots','bigChanceCreated','ballPossession',
          'passes','accurateCross','totalTackle','interceptionWon'];
        if (validKeys.includes(item.key)) {
          r[p].home[item.key] = extractValue(item.homeValue);
          r[p].away[item.key] = extractValue(item.awayValue);
        }
      }
    }
  }
  return r;
}

const TEAM_MAPPING = {
  'psg': 'paris saint-germain',
  'man city': 'manchester city',
  'man united': 'manchester united',
  'bayern': 'bayern münchen',
  'dortmund': 'borussia dortmund',
  'ath madrid': 'atlético madrid',
  'ath bilbao': 'athletic club',
  'sociedad': 'real sociedad',
  'betis': 'real betis',
  'lipsia': 'rb leipzig',
  'ein frankfurt': 'eintracht frankfurt',
  'austria vienna': 'austria wien',
  'amburgo': 'hamburger sv',
  'hamburg': 'hamburger sv',
  'espanol': 'espanyol',
  'fc koln': '1. fc köln',
  'forest': 'nottingham forest',
  'friburgo': 'sc freiburg',
  'heidenheim': '1. fc heidenheim',
  'leverkusen': 'bayer 04 leverkusen',
  "m'gladbach": 'borussia mönchengladbach',
  "borussia m'gladbach": 'borussia mönchengladbach',
  'st pauli': 'st. pauli',
  'vallecano': 'rayo vallecano',
  'wolves': 'wolverhampton',
  'rennes': 'stade rennais',
  'union berlin': '1. fc union berlin',
  'mainz': '1. fsv mainz 05',
  'hoffenheim': 'tsg hoffenheim',
  'celta': 'celta vigo',
  'alaves': 'deportivo alavés',
  'auxerre': 'aj auxerre',
  'brest': 'stade brestois',
  'brighton': 'brighton & hove albion',
  'le havre': 'le havre',
  'leeds': 'leeds united',
  'lens': 'rc lens',
  'lyon': 'olympique lyonnais',
  'marseille': 'olympique de marseille',
  'metz': 'fc metz',
  'monaco': 'as monaco',
  'nantes': 'fc nantes',
  'newcastle': 'newcastle united',
  'nice': 'ogc nice',
  'osasuna': 'ca osasuna',
  'strasbourg': 'rc strasbourg',
  'stuttgart': 'vfb stuttgart',
  'tottenham': 'tottenham hotspur',
  'toulouse': 'toulouse',
  'west ham': 'west ham united',
  
  // European Cup & Cup Synonyms
  'olympiakos piraeus': 'olympiacos',
  'olympiakos': 'olympiacos',
  'olympiacos fc': 'olympiacos',
  'union st. gilloise': 'union saint-gilloise',
  'union st gilloise': 'union saint-gilloise',
  'royale union saint-gilloise': 'union saint-gilloise',
  'rigas fs': 'rfs',
  'fk rigas futbola skola': 'rfs',
  'paok': 'paok',
  'paok fc': 'paok',
  'paok thessaloniki': 'paok',
  'fcsb': 'fcsb',
  'fcsb bucuresti': 'fcsb',
  'steaua bucuresti': 'fcsb',
  'rapid vienna': 'rapid wien',
  'copenhagen': 'kobenhavn',
  'fc copenhagen': 'kobenhavn',
  'guimaraes': 'vitoria sc',
  'vitoria guimaraes': 'vitoria sc',
  'borussia hildesheim': 'vfv borussia 06 hildesheim',
  
  // Spanish Cup & Racing Santander Mappings
  'racing santander': 'real racing club',
  'ejea': 'sd ejea',
  'hercules': 'hercules de alicante cf',
  'xerez': 'xerez cd',
  'ad ceuta': 'ad ceuta fc',
  'barbastro': 'ud barbastro',
  'amorebieta': 'sd amorebieta',
  'tudelano': 'cd tudelano',
  'deportiva minera': 'cd deportiva minera',
  'don benito': 'cd don benito',
  'llanera': 'ud llanera',
  'cultural leonesa': 'cultural y deportiva leonesa',
  'ibiza islas pitiusas': 'cd ibiza islas pitiusas',
  'gimnastic': 'gimnastic de tarragona',
  'langreo': 'up langreo',
  'orihuela': 'orihuela cf',
  'bergantiños': 'bergantinos fc',
  'marbella': 'marbella fc',
  'beasain': 'beasain sd',
  'mostoles': 'cd mostoles urjc',
  'burgos': 'burgos cf',
  'numancia': 'cd numancia',
  'sporting gijon': 'real sporting gijon',
};

function normalizeTeam(name) {
  if (!name) return '';
  // Rimuove accenti e caratteri speciali unicode (diacritici, es: Qarabağ -> Qarabag)
  let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (TEAM_MAPPING[n]) n = TEAM_MAPPING[n];
  return n
    .replace(/\b(fc|ac|as|ss|fk|gnk|sk|nk|bk|gfc|ud|sc|cf|sd|rc|sv|calcio)\b/g, '')
    .replace(/internazionale|inter milan/, 'inter')
    .replace(/hellas verona/, 'verona')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTeam(dbName, sofaName) {
  const d = normalizeTeam(dbName), s = normalizeTeam(sofaName);
  if (d === s) return true;

  // Eccezione specifica per impedire falsi positivi tra Angers (angers) e Rangers (rangers)
  if (
    (d === 'rangers' && s === 'angers') ||
    (d === 'angers' && s === 'rangers')
  ) {
    return false;
  }

  // Eccezione specifica per impedire falsi positivi tra Paris FC (paris) e PSG (paris saint-germain o psg)
  if (
    ((d === 'paris' || d === 'paris fc') && (s.includes('germain') || s === 'psg')) ||
    ((s === 'paris' || s === 'paris fc') && (d.includes('germain') || d === 'psg'))
  ) {
    return false;
  }
  
  // Eccezione specifica per Real Sociedad / Real Madrid / Real Betis
  if (
    (d === 'real' && (s.includes('madrid') || s.includes('sociedad') || s.includes('betis'))) ||
    (s === 'real' && (d.includes('madrid') || d.includes('sociedad') || d.includes('betis')))
  ) {
    return false;
  }

  // Previene matching errati tra Manchester City e Manchester United
  if (d.includes('manchester') && s.includes('manchester')) {
    const isCityD = d.includes('city');
    const isCityS = s.includes('city');
    const isUnitedD = d.includes('united');
    const isUnitedS = s.includes('united');
    if (isCityD !== isCityS || isUnitedD !== isUnitedS) return false;
  }

  if (d.includes(s) || s.includes(d)) return true;
  // Levenshtein
  const longer = d.length >= s.length ? d : s;
  const shorter = d.length < s.length ? d : s;
  if (!longer.length) return true;
  const costs = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    let prev = costs[0]; costs[0] = i;
    for (let j = 1; j <= shorter.length; j++) {
      const tmp = costs[j];
      costs[j] = longer[i-1] === shorter[j-1] ? prev :
        1 + Math.min(prev, costs[j], costs[j-1]);
      prev = tmp;
    }
  }
  const sim = (longer.length - costs[shorter.length]) / longer.length;
  return sim > 0.75;
}

// ── Main ─────────────────────────────────────────────────────────────
async function run() {
  const db = getDbClient();

  console.log('='.repeat(60));
  console.log(` SMART BACKFILL SofaScore — max ${MAX_MATCHES_PER_SESSION} match`);
  if (FILTER_LEAGUE) console.log(` Filtro lega: ${FILTER_LEAGUE}`);
  console.log('='.repeat(60));

  // Carica le partite senza SofaScore, ordinate per priorità lega
  let leagueFilter = FILTER_LEAGUE
    ? `AND league = '${FILTER_LEAGUE}'`
    : '';

  // Ordina per priorità lega personalizzata
  const priorityCase = LEAGUE_PRIORITY
    .map((l, i) => `WHEN league = '${l}' THEN ${i}`)
    .join(' ');

  const res = await db.execute({
    sql: `
      SELECT id, league, date, home_team, away_team
      FROM matches
      WHERE home_xg IS NULL ${leagueFilter}
        AND NOT (league IN ('ChampionsLeague', 'EuropaLeague', 'ConferenceLeague') 
                 AND strftime('%m', date) IN ('07', '08'))
      ORDER BY
        CASE ${priorityCase} ELSE 99 END,
        date DESC
    `,
  });

  const pending = res.rows;
  console.log(`\nPartite senza SofaScore nel DB: ${pending.length}`);

  if (pending.length === 0) {
    console.log('Tutto aggiornato! Nulla da fare.');
    return;
  }

  const toProcess = pending.slice(0, MAX_MATCHES_PER_SESSION);
  console.log(`Processo questa sessione: ${toProcess.length}`);

  // Raggruppa per data (una sola chiamata API per data)
  const byDate = {};
  for (const m of toProcess) {
    const d = m.date.split('T')[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }

  let processed = 0;
  let enriched = 0;
  let banned = false;

  for (const [date, matches] of Object.entries(byDate)) {
    if (banned) break;

    console.log(`\n--- Data: ${date} (${matches.length} partite da aggiornare) ---`);

    // Fetch eventi SofaScore per la data
    const eventsData = await fetchJson(
      `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`
    );

    if (!eventsData || eventsData.__error) {
      const status = eventsData?.status || 500;
      if (status === 404) {
        console.log(`  [!] Nessun evento trovato su SofaScore per il ${date} (HTTP 404).`);
        continue;
      }
      console.log(`  [!] Errore durante la fetch degli eventi (HTTP ${status}). Sessione interrotta.`);
      banned = true;
      break;
    }

    const finished = (eventsData.events || []).filter(e =>
      e.status?.type === 'finished'
    );
    console.log(`  SofaScore: ${finished.length} eventi conclusi trovati`);

    for (const dbMatch of matches) {
      processed++;

      // Trova il match su SofaScore
      let sofaEvent = finished.find(e =>
        matchTeam(dbMatch.home_team, e.homeTeam?.name) &&
        matchTeam(dbMatch.away_team, e.awayTeam?.name)
      );
      let inverted = false;

      if (!sofaEvent) {
        // Prova con i ruoli invertiti (es. campo neutro per finali/coppe)
        sofaEvent = finished.find(e =>
          matchTeam(dbMatch.home_team, e.awayTeam?.name) &&
          matchTeam(dbMatch.away_team, e.homeTeam?.name)
        );
        if (sofaEvent) {
          inverted = true;
          console.log(`  [INFO] Trovato match con ruoli invertiti su SofaScore: ${sofaEvent.homeTeam?.name} (casa Sofa) vs ${sofaEvent.awayTeam?.name} (trasferta Sofa)`);
        }
      }

      if (!sofaEvent) {
        console.log(`  [SKIP] Non trovato su SofaScore: ${dbMatch.home_team} vs ${dbMatch.away_team}`);
        // Match skippato: aggiorna comunque per non riprocessarlo sempre
        // (lasciamo home_xg NULL per indicare "provato ma non trovato" →
        //  potrebbe essere un match minore senza stats)
        continue;
      }

      console.log(`  [FETCH] ${dbMatch.home_team} vs ${dbMatch.away_team} (ID: ${sofaEvent.id})`);
      console.log(`  Attesa ${Math.round(DELAY_MIN_MS/1000)}s...`);
      await randomDelay();

      const statsData = await fetchJson(
        `https://api.sofascore.com/api/v1/event/${sofaEvent.id}/statistics`
      );

      if (statsData && statsData.__error) {
        if (statsData.status === 404) {
          console.log(`  [!] Nessuna statistica disponibile per questo match (HTTP 404). Procedo.`);
          // Imposta placeholder a -1 nel database così da non riprocessarlo più
          await db.execute({
            sql: `UPDATE matches SET
              home_xg=-1.0, away_xg=-1.0, home_xg_ht=-1.0, away_xg_ht=-1.0,
              home_corners_ht=-1.0, away_corners_ht=-1.0,
              home_yellows_ht=-1.0, away_yellows_ht=-1.0,
              home_reds_ht=-1.0, away_reds_ht=-1.0,
              home_offsides=-1.0, away_offsides=-1.0,
              home_shots_insidebox=-1.0, away_shots_insidebox=-1.0,
              home_big_chances=-1.0, away_big_chances=-1.0,
              home_possession=-1.0, away_possession=-1.0,
              home_passes=-1.0, away_passes=-1.0,
              home_crosses=-1.0, away_crosses=-1.0,
              home_tackles=-1.0, away_tackles=-1.0,
              home_interceptions=-1.0, away_interceptions=-1.0
              WHERE id=?`,
            args: [dbMatch.id]
          });
          continue;
        } else {
          console.log(`  [!] Errore durante la fetch delle statistiche (HTTP ${statsData.status}). Sessione interrotta.`);
          banned = true;
          break;
        }
      }

      if (!statsData || !statsData.statistics) {
        console.log(`  [!] Nessuna statistica disponibile per questo match.`);
        continue;
      }

      let s = parseStats(statsData.statistics);
      let ht = { home: sofaEvent.homeScore?.period1 ?? null, away: sofaEvent.awayScore?.period1 ?? null };

      if (inverted) {
        // Scambia le statistiche per allinearle al nostro DB
        const tempALLHome = s.ALL.home;
        s.ALL.home = s.ALL.away;
        s.ALL.away = tempALLHome;

        const temp1STHome = s['1ST'].home;
        s['1ST'].home = s['1ST'].away;
        s['1ST'].away = temp1STHome;

        const tempHtHome = ht.home;
        ht.home = ht.away;
        ht.away = tempHtHome;
      }

      await db.execute({
        sql: `UPDATE matches SET
          home_xg=?, away_xg=?, home_xg_ht=?, away_xg_ht=?,
          home_goals_ht=?, away_goals_ht=?,
          home_corners_ht=?, away_corners_ht=?,
          home_yellows_ht=?, away_yellows_ht=?,
          home_reds_ht=?, away_reds_ht=?,
          home_offsides=?, away_offsides=?,
          home_shots_insidebox=?, away_shots_insidebox=?,
          home_big_chances=?, away_big_chances=?,
          home_possession=?, away_possession=?,
          home_passes=?, away_passes=?,
          home_crosses=?, away_crosses=?,
          home_tackles=?, away_tackles=?,
          home_interceptions=?, away_interceptions=?
          WHERE id=?`,
        args: [
          s.ALL.home.expectedGoals ?? -1.0, s.ALL.away.expectedGoals ?? -1.0,
          s['1ST'].home.expectedGoals ?? -1.0, s['1ST'].away.expectedGoals ?? -1.0,
          ht.home, ht.away,
          s['1ST'].home.cornerKicks ?? null, s['1ST'].away.cornerKicks ?? null,
          s['1ST'].home.yellowCards ?? null, s['1ST'].away.yellowCards ?? null,
          s['1ST'].home.redCards ?? null, s['1ST'].away.redCards ?? null,
          s.ALL.home.offsides ?? null, s.ALL.away.offsides ?? null,
          s.ALL.home.insideBoxShots ?? null, s.ALL.away.insideBoxShots ?? null,
          s.ALL.home.bigChanceCreated ?? null, s.ALL.away.bigChanceCreated ?? null,
          s.ALL.home.ballPossession ?? null, s.ALL.away.ballPossession ?? null,
          s.ALL.home.passes ?? null, s.ALL.away.passes ?? null,
          s.ALL.home.accurateCross ?? null, s.ALL.away.accurateCross ?? null,
          s.ALL.home.totalTackle ?? null, s.ALL.away.totalTackle ?? null,
          s.ALL.home.interceptionWon ?? null, s.ALL.away.interceptionWon ?? null,
          dbMatch.id
        ]
      });

      enriched++;
      console.log(`  [OK] ${dbMatch.home_team} vs ${dbMatch.away_team} aggiornato (xG: ${s.ALL.home.expectedGoals ?? 'N/A'} - ${s.ALL.away.expectedGoals ?? 'N/A'})`);
    }

    if (banned) break;
    // Pausa extra tra date
    await delay(15000);
  }

  // Chiudi sessione Playwright alla fine
  if (sofaSession) {
    console.log('\n[SofaScore] Chiusura sessione Playwright...');
    await sofaSession.close();
  }

  console.log('\n' + '='.repeat(60));
  console.log(` SESSIONE COMPLETATA`);
  console.log(` Processati: ${processed} | Arricchiti: ${enriched} | Bloccati: ${banned ? 'SI' : 'NO'}`);
  console.log(` Rimanenti nel DB: ${pending.length - processed}`);
  if (pending.length - processed > 0) {
    console.log(` Ripeti domani: node smart_backfill.js`);
  }
  console.log('='.repeat(60));
}

run().catch(console.error);
