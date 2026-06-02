import { createClient } from '@libsql/client';
import { createSofaSession } from './lib/sofa_playwright.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Configurazione Leghe SofaScore ──────────────────────────────────────────
const SOFA_LEAGUE_MAP = {
  17: { name: 'Premier', type: 'league' },
  23: { name: 'SerieA', type: 'league' },
  8: { name: 'LaLiga', type: 'league' },
  4: { name: 'Ligue1', type: 'league' },
  35: { name: 'Bundes', type: 'league' },
  7: { name: 'ChampionsLeague', type: 'cup_european' },
  676: { name: 'EuropaLeague', type: 'cup_european' },
  17163: { name: 'ConferenceLeague', type: 'cup_european' },
  329: { name: 'CoppaItalia', type: 'cup_national' },
  191: { name: 'FACup', type: 'cup_national' },
  390: { name: 'CopaDelRey', type: 'cup_national' },
  315: { name: 'CoupeDeFrance', type: 'cup_national' },
  239: { name: 'DFBPokal', type: 'cup_national' },
  207: { name: 'EFLCup', type: 'cup_national' }
};

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

// ─── Utility normalizzazione e fuzzy match ────────────────────────────────────
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

// ─── Setup Database client ───────────────────────────────────────────────────
function getDbClient() {
  const envPath = path.join(process.cwd(), '.env.local');
  let url = 'file:resoconto.db';
  let authToken = undefined;

  // Carica da file di env locale se disponibile (in locale)
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
    url = process.env.TURSO_DATABASE_URL;
    authToken = process.env.TURSO_AUTH_TOKEN;
  }

  return createClient({ url, authToken });
}

// ─── Main Flow ───────────────────────────────────────────────────────────────
async function run() {
  const startTs = Date.now();
  console.log('='.repeat(60));
  console.log(' 🌌 NIGHTLY AUTOMATION SCHEDULER — SofaScore Stats, Re-Train & Predictions');
  console.log('='.repeat(60));

  const db = getDbClient();
  let sofaSession = null;

  try {
    // Inizializza data di oggi e domani
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log(`[INFO] Data odierna: ${todayStr}`);
    console.log(`[INFO] Data di domani: ${tomorrowStr}`);

    // Carica tutti i team esistenti nel database per il mapping
    const teamsRes = await db.execute("SELECT name, league FROM teams");
    const dbTeams = teamsRes.rows;
    console.log(`[INFO] Caricati ${dbTeams.length} team dal DB per fuzzy matching.`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1: Inserimento partite di domani
    // ══════════════════════════════════════════════════════════════════════════
    console.log(`\n[STEP 1] Fetch palinsesto di domani (${tomorrowStr})...`);
    sofaSession = await createSofaSession();
    
    const tomorrowEvents = await sofaSession.fetch(
      `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${tomorrowStr}`
    );

    let insertedFixtures = 0;
    if (tomorrowEvents && tomorrowEvents.events) {
      const targetEvents = tomorrowEvents.events.filter(e => 
        e.uniqueTournament && SOFA_LEAGUE_MAP[e.uniqueTournament.id]
      );
      console.log(`  Trovati ${targetEvents.length} eventi SofaScore per le nostre leghe.`);

      for (const event of targetEvents) {
        const leagueCfg = SOFA_LEAGUE_MAP[event.uniqueTournament.id];
        const sofaHomeName = event.homeTeam?.name;
        const sofaAwayName = event.awayTeam?.name;
        const refereeName = event.referee?.name ? event.referee.name.split(',')[0].replace('.', '').strip() : null;

        // Cerca i corrispettivi nomi nel DB tramite fuzzy matching
        const mappedHome = dbTeams.find(t => t.league === leagueCfg.name && matchTeam(t.name, sofaHomeName))?.name || sofaHomeName;
        const mappedAway = dbTeams.find(t => t.league === leagueCfg.name && matchTeam(t.name, sofaAwayName))?.name || sofaAwayName;

        // Inserisci i team nuovi nel DB se non ci sono
        await db.execute({
          sql: "INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)",
          args: [leagueCfg.name, mappedHome]
        });
        await db.execute({
          sql: "INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)",
          args: [leagueCfg.name, mappedAway]
        });

        // Inserisci il match di domani (unplayed, stats a 0, xG a NULL)
        const insertRes = await db.execute({
          sql: `INSERT OR IGNORE INTO matches (
            league, date, home_team, away_team,
            home_goals, away_goals,
            home_shots, away_shots, home_sot, away_sot,
            home_fouls, away_fouls, home_corners, away_corners,
            home_yellows, away_yellows, home_reds, away_reds,
            referee, competition_type
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
          args: [leagueCfg.name, tomorrowStr, mappedHome, mappedAway, refereeName, leagueCfg.type]
        });

        if (insertRes.rowsAffected > 0) {
          insertedFixtures++;
          console.log(`  [+] Inserito match: ${mappedHome} vs ${mappedAway} (${leagueCfg.name})`);
        }
      }
      console.log(`  [OK] Inserite ${insertedFixtures} nuove partite di domani nel DB.`);
    } else {
      console.log('  [WARN] Impossibile recuperare gli eventi di domani o nessun evento programmato.');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2: Aggiornamento risultati e statistiche xG delle partite di ieri
    // ══════════════════════════════════════════════════════════════════════════
    console.log(`\n[STEP 2] Aggiornamento statistiche SofaScore delle partite passate...`);
    const pendingRes = await db.execute({
      sql: `SELECT id, league, date, home_team, away_team 
            FROM matches 
            WHERE home_xg IS NULL AND date <= ? 
              AND NOT (league IN ('ChampionsLeague', 'EuropaLeague', 'ConferenceLeague') 
                       AND strftime('%m', date) IN ('07', '08'))
            ORDER BY date DESC LIMIT 15`,
      args: [todayStr]
    });
    
    const pendingMatches = pendingRes.rows;
    console.log(`  Trovate ${pendingMatches.length} partite passate senza statistiche SofaScore.`);

    if (pendingMatches.length > 0) {
      // Raggruppa per data (evita chiamate multiple per la stessa giornata)
      const byDate = {};
      for (const m of pendingMatches) {
        if (!byDate[m.date]) byDate[m.date] = [];
        byDate[m.date].push(m);
      }

      let enriched = 0;
      for (const [date, matches] of Object.entries(byDate)) {
        console.log(`  Elaborazione data: ${date}...`);
        const dateEvents = await sofaSession.fetch(
          `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`
        );

        if (!dateEvents || !dateEvents.events) {
          console.log(`  [WARN] Nessun dato SofaScore per il ${date}`);
          continue;
        }

        const finished = dateEvents.events.filter(e => e.status?.type === 'finished');

        for (const dbMatch of matches) {
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
            continue;
          }

          console.log(`  [FETCH] Dettagli per ${dbMatch.home_team} vs ${dbMatch.away_team} (ID: ${sofaEvent.id})...`);
          // Delay di sicurezza per simulare comportamento umano
          await new Promise(r => setTimeout(r, 20000));

          const statsData = await sofaSession.fetch(
            `https://api.sofascore.com/api/v1/event/${sofaEvent.id}/statistics`
          );

          if (statsData && statsData.__error) {
            if (statsData.status === 404) {
              console.log(`  [WARN] Statistiche non trovate su SofaScore per l'evento ${sofaEvent.id} (HTTP 404). Salvo placeholder.`);
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
            } else {
              console.log(`  [WARN] Errore fetch per l'evento ${sofaEvent.id} (HTTP ${statsData.status})`);
            }
            continue;
          }

          if (!statsData || !statsData.statistics) {
            console.log(`  [WARN] Statistiche non disponibili per l'evento ${sofaEvent.id}`);
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

          // Salva tutte le statistiche e i gol reali finiti
          await db.execute({
            sql: `UPDATE matches SET
              home_goals=?, away_goals=?,
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
              sofaEvent.homeScore?.normaltime ?? 0, sofaEvent.awayScore?.normaltime ?? 0,
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
          console.log(`  [OK] Aggiornato: ${dbMatch.home_team} vs ${dbMatch.away_team} (Final Score: ${sofaEvent.homeScore?.normaltime}-${sofaEvent.awayScore?.normaltime})`);
        }
      }
      console.log(`  [OK] Arricchite ${enriched} partite passate con statistiche SofaScore.`);
    }

    // Chiudi sessione browser Playwright
    if (sofaSession) {
      await sofaSession.close();
      sofaSession = null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3: Re-training veloce dei modelli Machine Learning (~30 secondi)
    // ══════════════════════════════════════════════════════════════════════════
    console.log(`\n[STEP 3] Avvio Re-training dei modelli finali con i nuovi dati...`);
    try {
      const { stdout } = await execAsync('python ml_train_all.py --nightly');
      console.log(stdout.trim());
      console.log(`  [OK] Re-training dei modelli finali completato!`);
    } catch (trainErr) {
      console.error(`  [ERR] Errore durante il training ML:`, trainErr.message);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4: Calcolo predizioni per le partite di domani
    // ══════════════════════════════════════════════════════════════════════════
    console.log(`\n[STEP 4] Calcolo predizioni statistiche per le partite di domani (${tomorrowStr})...`);
    const tomorrowFixturesRes = await db.execute({
      sql: `SELECT id, league, home_team, away_team, referee, competition_type 
            FROM matches 
            WHERE date = ? AND home_xg IS NULL`,
      args: [tomorrowStr]
    });

    const tomorrowFixtures = tomorrowFixturesRes.rows;
    console.log(`  Trovate ${tomorrowFixtures.length} partite di domani da predire.`);

    if (tomorrowFixtures.length > 0) {
      const batchData = tomorrowFixtures.map(f => ({
        home: f.home_team,
        away: f.away_team,
        referee: f.referee || '',
        league: f.league,
        competition_type: f.competition_type || 'league',
        date: tomorrowStr
      }));

      try {
        console.log(`  Calcolo predizioni batch con ml_predict.py...`);
        const { stdout } = await execAsync(`python ml_predict.py --batch '${JSON.stringify(batchData)}'`);
        const predictions = JSON.parse(stdout.trim());
        
        console.log(`  Salvataggio predizioni calcolate nel database...`);
        // NOTA: Poiché Next.js calcola i mercati on-the-fly tramite API,
        // registriamo le predizioni grezze in una cache o tabella di log se presente,
        // oppure le lasciamo calcolare on-the-fly. Stampi predizioni per il logger.
        console.log(`  [OK] Predizioni calcolate con successo per ${predictions.length} partite!`);
        for (let i = 0; i < tomorrowFixtures.length; i++) {
          const f = tomorrowFixtures[i];
          const p = predictions[i];
          if (p && !p.error) {
            console.log(`    - ${f.home_team} vs ${f.away_team}: Gol Previsti (H:${p.gol?.casa} - A:${p.gol?.ospite}) | Corner (H:${p.corner?.casa} - A:${p.corner?.ospite})`);
          }
        }
      } catch (predErr) {
        console.error(`  [ERR] Errore calcolo predizioni:`, predErr.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(` 🌌 NIGHTLY AUTOMATION COMPLETATA CON SUCCESSO IN ${((Date.now() - startTs) / 1000).toFixed(1)}s!`);
    console.log('='.repeat(60));

  } catch (err) {
    console.error('\n❌ ERRORE CRITICO DURANTE LA NIGHTLY AUTOMATION:', err.message);
  } finally {
    if (sofaSession) {
      await sofaSession.close();
    }
  }
}

run();
