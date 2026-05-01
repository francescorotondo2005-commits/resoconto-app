/**
 * lib/scraper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Playwright-based scraper per Sportium e Sportbet.
 * Esporta: scrapeBothBooks(league, homeTeam, awayTeam)
 *
 * ARCHITETTURA
 *  1. Cerca la partita su ciascun bookmaker
 *  2. Estra le quote dai mercati trovati
 *  3. Mappa i nomi dei mercati del bookmaker → nomi interni (come definiti in markets.js)
 *  4. Calcola l'Edge per ogni quota incrociandola con la probabilità statistica fornita
 *
 * Il modello di Edge è:  Edge = (Prob × Quota) - 1
 * Una value bet si ha quando Edge ≥ minEdge (passato come parametro, default 0.20).
 */

import { chromium } from 'playwright';

// ─── Timeout globali ───────────────────────────────────────────────────────────
const NAV_TIMEOUT  = 30_000;  // ms per navigazione pagina
const WAIT_TIMEOUT = 12_000;  // ms attesa elemento
const PAGE_LOAD    = 3_000;   // ms stabilizzazione JS dopo caricamento

/**
 * Chiude i banner dei cookie comuni (Staryes, Sportbet, Sportium)
 */
async function dismissCookies(page) {
  try {
    const banners = [
      '#CybotCookiebotDialogBodyButtonDecline', // Cookiebot Decline
      'button:has-text("Rifiuta")',             // Generic Rifiuta
      'button:has-text("Decline")',             // Generic Decline
      '.iubenda-cs-accept-btn',                 // Iubenda Accept
      'button:has-text("Accetta")',             // Generic Accetta
      'button:has-text("OK")',                  // Generic OK
    ];
    for (const selector of banners) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }
  } catch (e) {}
}

// ─── Mappa dei nomi mercato del bookmaker → nome interno ──────────────────────
// Formato: chiave = pattern (lowercase, parziale) → valore = nome esatto interno
// Aggiungere qui alias se il sito cambia le etichette.
const SPORTIUM_MARKET_MAP = {
  // 1X2
  '1x2 tiri in porta':            (line, dir) => `1X2 TIRI IN PORTA: ${dir}`,
  '1x2 tiri totali':              (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 tiri':                     (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 corner':                   (line, dir) => `1X2 CORNER: ${dir}`,
  '1x2 cartellini':               (line, dir) => `1X2 CARTELLINI: ${dir}`,
  '1x2 falli':                    (line, dir) => `1X2 FALLI: ${dir}`,
  '1x2':                          (line, dir) => `1X2 (ignorato)`,
  // Gol
  'over/under gol':               (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL`,
  'gol casa over/under':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  'gol ospite over/under':        (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,
  'gol partita over/under':       (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL`,
  // Tiri
  'tiri totali over/under':       (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI TOTALI`,
  'tiri casa over/under':         (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI CASA`,
  'tiri ospite over/under':       (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI OSPITE`,
  'tiri in porta totali':         (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA TOTALI`,
  'tiri in porta casa':           (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA CASA`,
  'tiri in porta ospite':         (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA OSPITE`,
  // Corner
  'corner totali over/under':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,
  'corner casa over/under':       (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,
  'corner ospite over/under':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`,
  'totale angoli over/under':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,
  // Falli
  'falli totali over/under':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI TOTALI`,
  'falli casa over/under':        (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI CASA`,
  'falli ospite over/under':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI OSPITE`,
  // Cartellini
  'cartellini totali over/under': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,
  'cartellini casa over/under':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI CASA`,
  'cartellini ospite over/under': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI OSPITE`,
  // 1X2
  '1x2 tiri in porta':            (line, dir) => `1X2 TIRI IN PORTA: ${dir}`,
  '1x2 tiri totali':              (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 tiri':                     (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 corner':                   (line, dir) => `1X2 CORNER: ${dir}`,
  '1x2 cartellini':               (line, dir) => `1X2 CARTELLINI: ${dir}`,
  '1x2 falli':                    (line, dir) => `1X2 FALLI: ${dir}`,
  '1x2':                          (line, dir) => `1X2 (ignorato)`, // ignora il generico a meno che non ci serve 1X2 base
};

const SPORTBET_MARKET_MAP = {
  // ── 1X2 MARKETS ─────────────────────────────────────────────────────────────
  '1x2 tiri in porta':      (line, dir) => `1X2 TIRI IN PORTA: ${dir}`,
  '1x2 tiri totali':        (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 tiri':               (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 corner':             (line, dir) => `1X2 CORNER: ${dir}`,
  '1x2 cartellini':         (line, dir) => `1X2 CARTELLINI: ${dir}`,
  '1x2 falli':              (line, dir) => `1X2 FALLI: ${dir}`,
  '1x2':                    (line, dir) => `1X2: ${dir}`,

  // ── TIRI IN PORTA ───────────────────────────────────────────────────────────
  'tiri in porta casa':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA CASA`,
  'tiri in porta ospite':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA OSPITE`,
  'tiri in porta totali':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA TOTALI`,
  'tiri in porta team 1':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA CASA`,
  'tiri in porta team 2':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA OSPITE`,
  'tiri in porta':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA TOTALI`,

  // ── TIRI TOTALI ─────────────────────────────────────────────────────────────
  'tiri totali casa':       (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI CASA`,
  'tiri totali ospite':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI OSPITE`,
  'tiri casa':              (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI CASA`,
  'tiri ospite':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI OSPITE`,
  'tiri totali team1':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI CASA`,
  'tiri totali team2':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI OSPITE`,
  'tiri totali':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI TOTALI`,
  'tiri':                   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI TOTALI`,

  // ── CARTELLINI ──────────────────────────────────────────────────────────────
  'cartellini casa':        (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI CASA`,
  'cartellini ospite':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI OSPITE`,
  'cartellini incontro':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,
  'cartellini totali':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,
  'cartellini team x':      (line, dir, labelStr) => {
      if (labelStr.match(/\b1\b|casa/)) return `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI CASA`;
      if (labelStr.match(/\b2\b|ospite/)) return `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI OSPITE`;
      return null;
  },
  'cartellini':             (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,

  // ── CORNER ──────────────────────────────────────────────────────────────────
  'corner casa':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,
  'corner ospite':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`,
  'corner squadra  1':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,
  'corner squadra  2':      (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`,
  'corner totali':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,
  'corner t.r.':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,
  'corner':                 (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,

  // ── FALLI ───────────────────────────────────────────────────────────────────
  'falli casa':             (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI CASA`,
  'falli ospite':           (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI OSPITE`,
  'falli commessi':         (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI TOTALI`,
  'falli':                  (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} FALLI TOTALI`,

  // ── PARATE ──────────────────────────────────────────────────────────────────
  'parate casa':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} PARATE CASA`,
  'parate ospite':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} PARATE OSPITE`,
  'parate':                 (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} PARATE TOTALI`,

  // ── GOL E UNDER/OVER GENERICI ──────────────────────────────────────────────────
  'gol casa':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  'gol ospite':  (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,

  // Fallback per quando il bookmaker usa solo il nome della squadra come etichetta
  // (es. "Under 1.5 Brentford" → GOL CASA)
  // Garantiamo che non catturino mercati statistici (tiri, cartellini, ecc.)
  ' casa': (line, dir, labelStr) => {
      if (labelStr.match(/tiri|corner|cartellini|falli|parate|sanzioni|contrasti|tackle|passaggi|giocatore/i)) return null;
      // Deve esserci un numero (la linea) affinché abbia senso: es. "under 1.5 casa"
      if (!labelStr.match(/\d/)) return null;
      return `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`;
  },
  ' ospite': (line, dir, labelStr) => {
      if (labelStr.match(/tiri|corner|cartellini|falli|parate|sanzioni|contrasti|tackle|passaggi|giocatore/i)) return null;
      if (!labelStr.match(/\d/)) return null;
      return `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`;
  },
  ' squadra 1': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  ' squadra 2': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,

  // Pattern U/O generico: blocchiamo SOLO se ci sono termini statistici chiari.
  // Nota: il mappingKey è "${mn} ${lb}" es. "u/o gol over" o "over/under 2.5 gol under"
  // La lunghezza del label NON è un criterio affidabile per distinguere i gol.
  'u/o': (line, dir, labelStr) => {
      if (labelStr.match(/tiri|corner|cartellini|falli|parate|sanzioni|contrasti/i)) return null;
      return `${dir.toUpperCase()} ${formatLine(line)} GOL`;
  },
  'over/under': (line, dir, labelStr) => {
      if (labelStr.match(/tiri|corner|cartellini|falli|parate|sanzioni|contrasti/i)) return null;
      return `${dir.toUpperCase()} ${formatLine(line)} GOL`;
  },
  'gol':   (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL`,
  'gg/ng': (line, dir) => dir.toLowerCase() === 'gg' ? 'GOAL' : 'NO GOAL',
};

// ─── Utility ──────────────────────────────────────────────────────────────────
/**
 * Formatta la linea come "X,5" per le intere o "X" per i float.
 * Es: 2.5 → "2,5" | 3 → "3,5" (perché le linee di mercato sono X,5)
 */
function formatLine(line) {
  const n = parseFloat(String(line).replace(',', '.'));
  if (isNaN(n)) return String(line);
  // Preserva le mezze linee (X.5) e converte le intere in X.5
  if (n % 1 === 0) return `${n},5`;
  // Arrotonda a 1 decimale e formatta con la virgola italiana
  return String(n).replace('.', ',');
}

// Prefissi/suffissi da rimuovere prima del confronto
const NOISE_WORDS = [
  'fc', 'cf', 'ac', 'as', 'sc', 'rc', 'cd', 'ud', 'sd', 'rcd', 'real', 'club',
  'calcio', 'football', 'soccer', 'sport', 'team', 'united', 'city', 'town',
  'tsg', 'tsv', 'vfb', 'vfl', 'vfr', 'bv', 'sv', 'rv', 'sg', 'fsv', 'ssv', '1',
  'de', 'del', 'la', 'los', 'las', 'el', 'il', 'lo', 'gli', 'le',
];

/**
 * Normalizza un nome squadra:
 *  1. Lowercase + rimuovi accenti
 *  2. Rimuovi caratteri non alfanumerici
 *  3. Rimuovi parole "rumore" (FC, TSG, AC, ecc.)
 *  4. Ritorna l'array dei token puliti
 */
function normalizeApostrophes(name) {
  return String(name || '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(name) {
  const lowerName = normalizeApostrophes(String(name || '').toLowerCase());
  
  // ALIAS per gestire discrepanze tra API-Football (spesso inglese/abbreviato) e Bookmaker italiani
  const aliases = {
    "m'gladbach": "monchengladbach",
    "mgladbach": "monchengladbach",
    "borussia m'gladbach": "monchengladbach",
    "borussia mgladbach": "monchengladbach",
    "rb leipzig": "lipsia leipzig",    // Mantiene leipzig e aggiunge lipsia
    "bayern munich": "bayern monaco",
    "b. leverkusen": "bayer leverkusen",
    "b . leverkusen": "bayer leverkusen",
    "stuttgart": "stoccarda",
    "union berlin": "union berlino",
    "eintracht": "eintracht francoforte frankfurt",
    "ein frankfurt": "eintracht francoforte frankfurt", // Nome tipico da API
    "frankfurt": "francoforte frankfurt",
    "nott'm forest": "nottingham forest",
    "wolves": "wolverhampton",
    "barcelona": "barcellona barcelona",
    "espanol": "espanyol espanol",
    "sevilla": "siviglia sevilla",
    "psg": "paris sg",
    "paris saint germain": "paris sg",
    "koln": "colonia koln",
    "cologne": "colonia koln",
    "bremen": "bremen brema",
    "mainz": "mainz magonza",
    "freiburg": "freiburg friburgo",
    "augsburg": "augsburg augusta",
    "mallorca": "mallorca maiorca",
    "vallecano": "vallecano rayo",
    "cadiz": "cadiz cadice",
    "betis": "betis",
    "athletic": "athletic bilbao",
    "nice": "nice nizza",
    "marseille": "marseille marsiglia",
    "lyon": "lyon lione",
    "lille": "lille lilla",
    "strasbourg": "strasbourg strasburgo",
    "toulouse": "toulouse tolosa"
  };

  const aliasTokens = [];
  for (const [key, val] of Object.entries(aliases)) {
    const normalizedKey = normalizeApostrophes(key);
    if (lowerName.includes(normalizedKey)) {
      aliasTokens.push(...String(val)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 0 && !NOISE_WORDS.includes(t)));
    }
  }

  const base = lowerName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // rimuovi diacritici
    .replace(/[^a-z0-9\s]/g, ' ')      // sostituisci non-alfanumerico con spazio
    .trim();

  const baseTokens = base
    .split(/\s+/)
    .filter(t => t.length > 0 && !NOISE_WORDS.includes(t));

  return [...new Set([...baseTokens, ...aliasTokens])];
}

function buildMatchSearchRegex(...names) {
  const tokens = names
    .flatMap(name => tokenize(name))
    .filter((token, index, array) => token.length >= 3 && array.indexOf(token) === index)
    .sort((a, b) => b.length - a.length);

  if (!tokens.length) return /.*/;
  return new RegExp(tokens.map(escapeRegExp).join('|'), 'i');
}

/**
 * Distanza di Levenshtein (edit distance) tra due stringhe.
 * Usata come fallback estremo per nomi molto diversi.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Confronto fuzzy tra nome squadra del DB e nome estratto dal bookmaker.
 * Strategie (in ordine di precisione):
 *  1. Match esatto dei token normalizzati
 *  2. Tutti i token della versione più corta sono contenuti nella più lunga
 *  3. Almeno 1 token di lunghezza ≥ 4 condiviso tra i due nomi
 *  4. Levenshtein ≤ 2 su almeno un token significativo (≥ 4 char)
 */
function fuzzyTeamMatch(dbName, bookmakerName) {
  const dbTokens   = tokenize(dbName);
  const bookTokens = tokenize(bookmakerName);

  if (dbTokens.length === 0 || bookTokens.length === 0) return false;

  // Strategia 1: match esatto dei token
  const dbSet   = new Set(dbTokens);
  const bookSet = new Set(bookTokens);
  for (const t of dbSet) { if (bookSet.has(t)) return true; }

  // Strategia 2: tutti i token del nome più corto sono contenuti nell'altro
  const [shorter, longer] = dbTokens.length <= bookTokens.length
    ? [dbTokens, bookTokens]
    : [bookTokens, dbTokens];
  const longerStr = longer.join(' ');
  if (shorter.every(t => longerStr.includes(t))) return true;

  // Strategia 3: token overlap — almeno 1 token ≥ 4 char in comune parzialmente
  const dbSig   = dbTokens.filter(t => t.length >= 4);
  const bookSig = bookTokens.filter(t => t.length >= 4);
  for (const dt of dbSig) {
    for (const bt of bookSig) {
      if (dt.includes(bt) || bt.includes(dt)) return true;
    }
  }

  // Strategia 4: Levenshtein ≤ 2 su coppie di token significativi
  for (const dt of dbSig) {
    for (const bt of bookSig) {
      if (levenshtein(dt, bt) <= 2) return true;
    }
  }

  return false;
}

/**
 * Controlla se un testo di link/elemento di pagina corrisponde alla fixture cercata.
 * Impone che ENTRAMBE le squadre trovino un match nel testo.
 *
 * @param {string} text        - Testo estratto dalla pagina
 * @param {string} homeTeam    - Nome squadra casa (dal nostro DB)
 * @param {string} awayTeam    - Nome squadra ospite (dal nostro DB)
 * @returns {boolean}
 */
function matchesFixture(text, homeTeam, awayTeam) {
  // Split sul separatore comune vs / - per isolare le due squadre nel testo.
  // Supporta anche le variazioni tipografiche e abbreviazioni come "vs.", "v", "@".
  const parts = text.split(/\s+(?:vs?\.?|v\.?|@|–|—|-|\||\/)\s+/i);
  let textHome = text;
  let textAway = text;
  if (parts.length >= 2) {
    textHome = parts[0];
    textAway = parts[parts.length - 1];
  }

  const fullHomeMatch = fuzzyTeamMatch(homeTeam, text);
  const fullAwayMatch = fuzzyTeamMatch(awayTeam, text);
  if (fullHomeMatch && fullAwayMatch) return true;

  const hMatchDirect = fuzzyTeamMatch(homeTeam, textHome) || fullHomeMatch;
  const aMatchDirect = fuzzyTeamMatch(awayTeam, textAway) || fullAwayMatch;
  if (hMatchDirect && aMatchDirect) return true;

  if (parts.length > 2) {
    for (let i = 1; i < parts.length; i += 1) {
      const left = parts.slice(0, i).join(' ').trim();
      const right = parts.slice(i).join(' ').trim();
      if (fuzzyTeamMatch(homeTeam, left) && fuzzyTeamMatch(awayTeam, right)) return true;
      if (fuzzyTeamMatch(homeTeam, right) && fuzzyTeamMatch(awayTeam, left)) return true;
    }
  }

  // Fallback: prova anche ordine invertito (bookmaker potrebbe mettere ospite prima)
  const hMatchInv = fuzzyTeamMatch(homeTeam, textAway) || fullHomeMatch;
  const aMatchInv = fuzzyTeamMatch(awayTeam, textHome) || fullAwayMatch;
  return hMatchInv && aMatchInv;
}

/**
 * Mappa un label di mercato del bookmaker al nome interno usando la mappa fornita.
 * Restituisce null se non c'è corrispondenza.
 */
function mapMarketName(rawLabel, line, direction, marketMap, homeTeam = '', awayTeam = '') {
  let label = rawLabel.toLowerCase().trim();
  const hTeam = (homeTeam || '').toLowerCase();
  const aTeam = (awayTeam || '').toLowerCase();
  
  const invalidKeywords = [
    'ht/ft', 'parziale', ' tempo', '°tempo', 'doppia chance 1', 'doppia chance 2',
    '1/1', '1/x', '1/2', 'x/1', 'x/x', 'x/2', '2/1', '2/x', '2/2',
    'multigol', 'margine', 'combo', 'minuto', 'sanzioni', 'ribaltone', 'doppietta', 'metodo', 'ribalta',
    'pari/dispari', 'plus', 'rigore', 'var', 'palo', 'traversa', 'valore',
    'giocatore', 'sostituto', 'assist', 'marcatore', 'segna', 'panchina',
    'fuorigioco', 'rimesse', 'possesso', 'sostituzion', 'passaggi', 'contrasti', 'tackle'
  ];
  for (const kw of invalidKeywords) {
      const kwRegex = new RegExp(`(?:\\b|_|\\s)${kw.replace(/[+°/.]/g, '\\$&')}(?:\\b|_|\\s|$)`, 'i');
      if (kwRegex.test(label) || label.includes(kw)) return null;
  }


  // Normalizzazione dei riferimenti squadra.
  // ATTENZIONE: (?![.,\d]) evita di matchare il "1" in "1.5" o il "2" in "2.5",
  // perché il punto è un word boundary e senza questo la linea verrebbe corrotta.
  let unifiedLabel = label
    // "squadra 1", "team 1", "squadra1", "team1" → casa
    .replace(/\b(?:squadra|team)\s*1\b/gi, ' casa ')
    // "squadra 2", "team 2", "squadra2", "team2" → ospite
    .replace(/\b(?:squadra|team)\s*2\b/gi, ' ospite ')
    // "1" isolato (es. fine stringa, preceduto da spazio) ma NON se è parte di un decimale come "1.5" o "1,5"
    .replace(/(?<![.\d,])(?<!\w)\b1\b(?![.,\d])/g, ' casa ')
    .replace(/(?<![.\d,])(?<!\w)\b2\b(?![.,\d])/g, ' ospite ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (hTeam && unifiedLabel.includes(hTeam)) {
      unifiedLabel = unifiedLabel.replace(hTeam, 'casa');
  } else if (aTeam && unifiedLabel.includes(aTeam)) {
      unifiedLabel = unifiedLabel.replace(aTeam, 'ospite');
  } else {
      // Prova match parziale se il nome squadra è lungo
      if (hTeam && hTeam.length > 4 && unifiedLabel.includes(hTeam.substring(0, 5))) {
          unifiedLabel = unifiedLabel.replace(hTeam.substring(0, 5), 'casa');
      }
      if (aTeam && aTeam.length > 4 && unifiedLabel.includes(aTeam.substring(0, 5))) {
          unifiedLabel = unifiedLabel.replace(aTeam.substring(0, 5), 'ospite');
      }
  }
  
  // Scansione della mappa per trovare il matching più specifico
  for (const [pattern, fn] of Object.entries(marketMap)) {
    if (unifiedLabel.includes(pattern)) {
      return fn(line, direction, unifiedLabel);
    }
  }
  return null;
}

// ─── Chiusura menu assistenza/chat ───────────────────────────────────────────
/**
 * Chiude il widget di assistenza/live chat se aperto.
 * I widget comuni su siti scommesse: Intercom, HelpCrunch, LiveChat, widget custom.
 */
async function dismissChatWidget(page) {
  try {
    // Selettori comuni per chiudere widget chat/assistenza
    const closeSelectors = [
      // Intercom
      '[class*="intercom"] button[aria-label*="close" i], [class*="intercom"] button[aria-label*="chiudi" i]',
      '#intercom-container button[aria-label*="close" i]',
      '.intercom-lightweight-app-launcher',  // click per chiudere/minimizzare
      // HelpCrunch
      'button.helpcrunch-close-button, .hc-button-close, [class*="helpcrunch"] [class*="close"]',
      // Zendesk
      '[data-garden-id="buttons.button"][aria-label*="close" i]',
      // Widget custom Staryes
      '#chat-widget-close, #close-chat, .chat-close, [class*="chat"] [class*="close"], [id*="chat"] button[class*="close"]',
      // Pulsanti generici "Chiudi" / "X" vicino a widget chat nella sidebar sinistra
      'button[aria-label="Chiudi"], button[title="Chiudi"], button[aria-label="Close"], button[title="Close"]',
    ];

    for (const sel of closeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(()=>false)) {
        await btn.click({ force: true }).catch(()=>null);
        await page.waitForTimeout(500);
        console.log(`[Staryes] Chat/widget chiuso (${sel.substring(0, 60)})`);
        break;
      }
    }

    // Pressa ESC per chiudere qualunque overlay aperto
    await page.keyboard.press('Escape').catch(()=>null);
  } catch {
    // Ignora - non è critico
  }
}

async function waitForStaryesLeagueContent(page, leagueNameFallback) {
  try {
    await page.waitForFunction((leagueName) => {
      const rootText = document.body ? document.body.innerText : '';
      const hasLeagueName = leagueName ? new RegExp(leagueName, 'i').test(rootText) : false;
      const readyNode = document.querySelector(
        '.lista-quote-interna-fastbet, .fast-bet-ext-btn, .fas.fa-caret-square-down, .competition-item, .landing-sport-item, .popular-leagues, .event-item, .match-item, .match, .teams-inline, .section-title'
      );
      return !!readyNode || hasLeagueName;
    }, leagueNameFallback, { timeout: 12000 });
    return true;
  } catch {
    return false;
  }
}

async function navigateStaryesLeagueDirect(page, slug, leagueNameFallback) {
  const candidates = [
    `https://www.staryes.it/scommesse/sport/calcio/${slug}`,
    `https://www.staryes.it/scommesse/sport/calcio/${slug.replace('-', '/')}`
  ];

  for (const directUrl of candidates) {
    try {
      console.log(`[Staryes] Navigazione diretta: ${directUrl}`);
      await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4000);
      await dismissCookies(page);
      const ready = await waitForStaryesLeagueContent(page, leagueNameFallback);
      if (ready) return true;
    } catch (e) {
      console.log(`[Staryes] Direct URL fallito: ${directUrl} (${e.message})`);
    }
  }
  return false;
}

// ─── Scraper Sportium — API-based ─────────────────────────────────────────────
// Invece di navigare la SPA Angular (che non renderizza in headless/headful),
// interroghiamo direttamente le API JSON di Sportium per trovare Match_Id e
// MatchAlias, poi navighiamo alla pagina evento per estrarre le quote.
async function scrapeSportium(page, league, homeTeam, awayTeam) {
  const results = {};
  const errors = [];

  try {
    const LEAGUE_MAP = {
      'SerieA': { slug: 'italia-serie-a', nome: 'Serie A' },
      'Premier': { slug: 'inghilterra-premier-league', nome: 'Premier League' },
      'LaLiga': { slug: 'spagna-liga', nome: 'LaLiga' },
      'Ligue1': { slug: 'francia-ligue-1', nome: 'Ligue 1' },
      'Bundes': { slug: 'germania-bundesliga', nome: 'Bundesliga' },
    };

    const map = LEAGUE_MAP[league] || LEAGUE_MAP['SerieA'];
    const slug = map.slug;
    const leagueNameFallback = map.nome;

    console.log('[Staryes] Step 1-2: Navigo direttamente al portale Scommesse');
    await page.goto('https://www.staryes.it/scommesse', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await dismissCookies(page);

    // Se il sito ha forzato un redirect alla homepage root (es. per il login/casino), clicchiamo sul tab SCOMMESSE
    if (page.url() === 'https://www.staryes.it/' || page.url() === 'https://www.staryes.it') {
        console.log('[Staryes] Redirect forzato rilevato, clicco sul tab SCOMMESSE...');
        const scommesseBtn = page.locator('a, span').filter({ hasText: /^SCOMMESSE$|^SPORT$/i }).first();
        if (await scommesseBtn.isVisible().catch(()=>false)) {
             await scommesseBtn.click({ force: true });
             await page.waitForTimeout(5000);
        }
    }

    // Workaround SPA: se la pagina è rimasta "incantata" sul caricamento (molto frequente su rete non perfetta)
    // una semplice ricarica sblocca il fetch dei dati JSON del framework Angular/React.
    const isBlankOrLoading = await page.evaluate(() => {
        const hasLanding = document.querySelectorAll('.landing-sport-item, .popular-leagues, .competition-item').length > 0;
        const hasLeagueContent = document.querySelectorAll('.section-title, .match, .match-item, .teams-inline, .bets-header-item').length > 0;
        return !hasLanding && !hasLeagueContent;
    }).catch(()=>false);

    if (isBlankOrLoading) {
        console.log('[Staryes] Rilevato caricamento infinito o pagina bianca. Riavvio (Reload) forzato SPA...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(6000);
        await dismissCookies(page);
    }

    console.log(`[Staryes] Step 3: Navigo al campionato "${leagueNameFallback}" dalla tabella centrale`);

    let clickedCentral = false;
    const selectors = [
      `.landing-sport-item:has-text("${leagueNameFallback}")`,
      `.landing-sport-content:has-text("${leagueNameFallback}")`,
      `.popular-leagues:has-text("${leagueNameFallback}")`,
      `.competition-item:has-text("${leagueNameFallback}")`
    ];

    for (const sel of selectors) {
       const el = page.locator(sel).first();
       if (await el.isVisible({ timeout: 1500 }).catch(()=>false)) {
           console.log(`[Staryes] Clicco "${leagueNameFallback}" nella tabella centrale col selettore: ${sel}`);
           await el.scrollIntoViewIfNeeded().catch(()=>null);
           await el.click({ force: true });
           clickedCentral = true;
           await page.waitForTimeout(6000); // Wait for matches to load via AJAX
           break;
       }
    }

    if (!clickedCentral) {
      console.log('[Staryes] Tabella centrale non trovata, tento find basico sui link...');
      const fallbackClick = page.locator(`a:text-is("${leagueNameFallback}"), div:text-is("${leagueNameFallback}")`).first();
      if (await fallbackClick.isVisible({ timeout: 2000 }).catch(()=>false)) {
          console.log(`[Staryes] Cliccato testo base...`);
          await fallbackClick.click({ force: true });
          await page.waitForTimeout(6000);
      } else {
          console.log('[Staryes] Fallback navigazione diretta URL...');
          const directOK = await navigateStaryesLeagueDirect(page, slug, leagueNameFallback);
          if (!directOK) {
             console.log('[Staryes] Fallback diretta completato ma non ho ancora trovato il contenuto atteso. Provo reload e attendo ancora.');
             await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(()=>null);
             await page.waitForTimeout(6000);
             await dismissCookies(page);
             await waitForStaryesLeagueContent(page, leagueNameFallback);
          }
      }
    }

    // Auto-Heal: Staryes a volte restituisce "Errore durante il caricamento dei dati" per colpa 
    // del token SPA mancante. Simuliamo l'utente cliccando l'icona "Ricarica" e il link nel menu di sinistra.
    if (await page.getByText('Errore durante il caricamento dei dati').isVisible().catch(()=>false)) {
        console.log('[Staryes] ⚠️ Rilevato "Errore durante il caricamento dei dati" a schermo. Eseguo ripristino...');
        
        // 1. Tentativo refresh dal tastino della loro UI
        const internalRefresh = page.locator('.fa-sync-alt, i.sync, [title="Ricarica"]').first();
        if (await internalRefresh.isVisible().catch(()=>false)) {
            await internalRefresh.click({ force: true }).catch(()=>null);
            await page.waitForTimeout(4000);
        }

        // 2. Se ancora rotto, clicchiamo forzatamente il menu "IN EVIDENZA" nella barra laterale sinistra
        if (await page.getByText('Errore durante il caricamento dei dati').isVisible().catch(()=>false)) {
            console.log('[Staryes] Provo a ricaricare i dati cliccando il campionato dalla barra laterale sinistra...');
            const sidebarLnk = page.locator('.left-menu, #left-column, .sidebar').getByText(leagueNameFallback, { exact: true }).first();
            if (await sidebarLnk.isVisible().catch(()=>false)) {
                await sidebarLnk.scrollIntoViewIfNeeded().catch(()=>null);
                await sidebarLnk.click({ force: true }).catch(()=>null);
                await page.waitForTimeout(6000);
            }
        }
    }

    await dismissChatWidget(page);
    await page.screenshot({ path: 'c:\\Users\\pierr\\.gemini\\antigravity\\brain\\00c37d85-2055-41af-b5ba-61dd3d160693\\staryes_step4_debug.png', fullPage: true });

    console.log(`[Staryes] Step 4: Cerco la partita "${homeTeam} - ${awayTeam}" e la tendina`);
    const rowSearchRegex = buildMatchSearchRegex(homeTeam, awayTeam);

    // Strategia principale: cerca direttamente elementi team e risali al container
    console.log('[Staryes] Strategia principale: cerco elementi team');
    const teamElements = await page.locator('.team-home, .team-away, .teams-inline, [class*="team"]').filter({ hasText: rowSearchRegex }).all();
    console.log(`[Staryes] Trovati ${teamElements.length} elementi team`);

    let potentialRows = [];
    const uniqueContainers = new Set();
    for (const teamEl of teamElements) {
      // Risali al container match più vicino
      const container = await teamEl.locator('xpath=ancestor::div[contains(@class, "match") or contains(@class, "event") or contains(@class, "row")][1]').first();
      if (await container.count() > 0) {
        uniqueContainers.add(container);
      }
    }
    potentialRows = Array.from(uniqueContainers);
    console.log(`[Staryes] Container unici trovati: ${potentialRows.length}`);

    // Fallback: se non trova container, usa gli elementi team stessi come righe
    if (potentialRows.length === 0 && teamElements.length > 0) {
      console.log('[Staryes] Fallback: uso elementi team come righe');
      potentialRows = teamElements;
    }

    // Ultimo fallback: selettori generici
    if (potentialRows.length === 0) {
      console.log('[Staryes] Ultimo fallback: selettori generici di riga');
      potentialRows = await page.locator('div, tr, li, a, section, article, button, span').filter({ hasText: rowSearchRegex }).all();
      console.log(`[Staryes] Candidate generiche trovate: ${potentialRows.length}`);
    }

    // Filtra righe troppo lunghe (probabilmente intere sezioni invece di singole righe)
    const filteredRows = [];
    for (const row of potentialRows) {
      const text = (await row.textContent().catch(() => '')).trim();
      if (text.length <= 2000) { // Aumentato leggermente per container match
        filteredRows.push(row);
      } else {
        console.log(`[Staryes] Riga troppo lunga scartata: ${text.length} chars`);
      }
    }
    potentialRows = filteredRows;
    console.log(`[Staryes] Dopo filtro lunghezza: ${potentialRows.length} righe`);
    
    let validRows = [];
    for (const row of potentialRows) {
      const text = (await row.textContent().catch(() => '')).trim();
      console.log(`[Staryes] Testando riga candidato (${text.length} chars): "${text.substring(0, 300)}..."`);
      const isMatch = matchesFixture(text, homeTeam, awayTeam);
      console.log(`[Staryes] Match result: ${isMatch} per "${homeTeam} - ${awayTeam}"`);
      if (text && text.length > 10 && text.length < 2500 && isMatch) {
         validRows.push({ row, text, len: text.length });
      }
    }
    console.log(`[Staryes] Trovate ${validRows.length} righe per il match validRows.`);
    validRows.forEach((r, i) => console.log(`  -> Riga ${i+1}: ${r.text.substring(0, 100).replace(/\n/g, ' ')}...`));

    if (validRows.length === 0) {
      console.log('[Staryes] Fallback avanzato: cerco elementi team e risalgo al container righe');
      const teamSelectors = ['.team-home', '.team-away', '.teams-inline', '.event-name'];
      const teamNodes = await page.locator(teamSelectors.join(',')).filter({ hasText: rowSearchRegex }).all();
      for (const teamNode of teamNodes) {
        const rowCandidate = teamNode.locator('xpath=ancestor::div[contains(@class, "match") or contains(@class, "event") or contains(@class, "row") or contains(@class, "event-item")][1]').first();
        if (await rowCandidate.count() === 0) continue;
        const text = (await rowCandidate.textContent().catch(() => '')).trim();
        if (text && text.length > 10 && text.length < 2500 && matchesFixture(text, homeTeam, awayTeam)) {
          validRows.push({ row: rowCandidate, text, len: text.length });
        }
      }
      console.log(`[Staryes] Fallback avanzato trovate ${validRows.length} righe`);
      validRows.forEach((r, i) => console.log(`  -> Fallback Riga ${i+1}: ${r.text.substring(0, 100).replace(/\n/g, ' ')}...`));
    }

    let clickedRowLocator = null;
    let clickedDropdown = false;

    if (validRows.length > 0) {
        validRows.sort((a, b) => a.len - b.len);
        for (let rowObj of validRows) {
           // Classe reale: "fas fa-caret-square-down pointer"
           const triangleBtn = rowObj.row.locator(
             '.fa-caret-square-down, .fas.fa-caret-square-down, [id^="apri-fastbet"], i.caret, i.caret-down, .fast-bet-ext-btn'
           ).first();
           if (await triangleBtn.isVisible({ timeout: 1500 }).catch(()=>false)) {
               console.log(`[Staryes] ✅ Trovata tendina verticale Fastbet (dentro riga)!`);
               clickedRowLocator = rowObj.row;
               await triangleBtn.scrollIntoViewIfNeeded().catch(()=>null);
               const box = await triangleBtn.boundingBox();
               if (box) {
                   await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 150 });
               } else {
                   await triangleBtn.click({ force: true }).catch(()=>null);
               }
               clickedDropdown = true;
               await page.waitForTimeout(4000);
               break;
           }
        }

        // --- STRATEGIA 2: usa page.evaluate() per trovare il caret nel DOM (bypassa isVisible) ---
        // Il caret NON è figlio della riga ma è sibling. Lo cerchiamo direttamente nel DOM
        // passando la posizione Y della riga come riferimento.
        if (!clickedDropdown) {
            const refRow = validRows.find(r => r.len > 40) || validRows[0];
            await refRow.row.scrollIntoViewIfNeeded().catch(()=>null);
            await page.waitForTimeout(500);

            // Prima forza la chiusura di qualunque overlay/widget dal DOM via JS
            await page.evaluate(() => {
                // Rimuovi overlay Intercom/HelpCrunch/Zendesk dal DOM
                const overlays = document.querySelectorAll(
                  '[class*="intercom"], [class*="helpcrunch"], [class*="livechat"], [id*="chat-widget"], #launcher'
                );
                overlays.forEach(el => { try { el.style.display = 'none'; el.style.pointerEvents = 'none'; } catch {} });
            }).catch(()=>null);

            const refBox = await refRow.row.boundingBox().catch(()=>null);
            const currentUrl = page.url();
            const totalIcount = await page.evaluate(() => document.querySelectorAll('i').length);
            console.log(`[Staryes] Strategia 2: URL=${currentUrl}, refBox=${JSON.stringify(refBox)}, total <i> nel DOM: ${totalIcount}`);

            if (refBox) {
                // Cerca tutti i caret DIRETTAMENTE nel DOM con JS, bypassando isVisible()
                const caretCoords = await page.evaluate((refY) => {
                    // SELETTORI CONFERMATI dal DOM reale di Staryes:
                    // Gli elementi hanno classe "fas fa-caret-square-down pointer"
                    // e id "apri-fastbet-in-quote-XXXXXXX"
                    const selectors = [
                        '[id^="apri-fastbet"]',           // ← id esatto confermato
                        '[class*="fa-caret-square-down"]', // ← class parziale (funziona con multiple classi)
                        '.fast-bet-ext-btn',
                    ];
                    const found = [];
                    for (const sel of selectors) {
                        document.querySelectorAll(sel).forEach(el => {
                            const r = el.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                found.push({
                                    x: r.left + r.width / 2 + window.scrollX,
                                    y: r.top + r.height / 2 + window.scrollY,
                                    dist: Math.abs((r.top + r.height / 2) - refY),
                                    cls: el.className,
                                });
                            }
                        });
                        if (found.length > 0) break;
                    }
                    found.sort((a, b) => a.dist - b.dist);
                    return found;
                }, refBox.y + refBox.height / 2);

                console.log(`[Staryes] Strategia 2: caret nel DOM: ${caretCoords.length} (primo dist=${caretCoords[0]?.dist?.toFixed(0)}px)`);

                if (caretCoords.length > 0 && caretCoords[0].dist < 600) {
                    const best = caretCoords[0];
                    console.log(`[Staryes] ✅ Caret trovato nel DOM (dist ${best.dist.toFixed(0)}px, cls="${best.cls}") — click!`);
                    await page.mouse.click(best.x, best.y, { delay: 150 });
                    clickedRowLocator = refRow.row;
                    clickedDropdown = true;
                    await page.waitForTimeout(4000);
                }
            }
        }


        // --- STRATEGIA 3: ultimo fallback — naviga alla pagina match ---
        if (!clickedDropdown) {
          console.log(`[Staryes] ❌ Tendina non trovata, tento di aprire la pagina del match...`);
          const clickableRow = validRows.find(r => r.len > 40) || validRows[0];
          await clickableRow.row.scrollIntoViewIfNeeded().catch(()=>null);
          const matchLink = clickableRow.row.locator('a, .teams-inline, .left-section, .info, .event-name').first();
          if (await matchLink.isVisible().catch(()=>false)) {
               await matchLink.click({ force: true }).catch(()=>null);
          } else {
               await clickableRow.row.click({ force: true }).catch(()=>null);
          }
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(4000);
        }
    } else {
        console.log(`[Staryes] ❌ Nessuna riga corrispondente trovata.`);
        errors.push(`Staryes: riga match non trovata`);
        return { odds: results, errors };
    }

    console.log(`[Staryes] Step 5: Estrapolazione delle quote visibili...`);
    
    const domEvaluateFn = (rootNode) => {
        const nodeToSearch = rootNode || document;
        const out = [];

        // METODO 1: Layout a tendina Staryes/Sportbet (Fastbet list)
        const fastbetLists = nodeToSearch.querySelectorAll('.lista-quote-interna-fastbet');
        if (fastbetLists.length > 0) {
            fastbetLists.forEach(list => {
                let currentTitle = ''; // carry-over: il titolo viene ereditato tra li consecutivi
                const items = list.querySelectorAll('li');
                items.forEach(li => {
                    const titleEl = li.querySelector('span.grassetto, .events-title-fastbet');
                    // Aggiorna il titolo solo se questo li ne ha uno proprio
                    if (titleEl && titleEl.textContent.trim()) {
                        currentTitle = titleEl.textContent.trim();
                    }
                    // Senza nessun titolo (nemmeno ereditato) salta
                    if (!currentTitle) return;

                    const oddsElements = li.querySelectorAll('.fast-bets-odd, .item-fastbet');
                    oddsElements.forEach(oddEl => {
                        const text = oddEl.textContent.trim();
                        const colonIdx = text.lastIndexOf(':');
                        if (colonIdx < 0) return;
                        const label = text.substring(0, colonIdx).trim();
                        const oddsStr = text.substring(colonIdx + 1).trim();
                        const odds = parseFloat(oddsStr.replace(',', '.'));

                        const isPlayerPropLabel = label.includes('(') || label.includes(')') || label.includes('+') || label.length > 25;
                        const isComboTitle = currentTitle.includes('&') || currentTitle.includes('+') || currentTitle.toLowerCase().includes('esatti') || currentTitle.toLowerCase().includes('tempo');

                        if (!isNaN(odds) && odds > 1 && !isPlayerPropLabel && !isComboTitle) {
                            out.push({ marketName: currentTitle, label, odds });
                        }
                    });
                });
            });
        }
        
        if (out.length > 5) return out;

        // METODO 2: Blocchi classici / match page (fallback)
        const marketBlocks = nodeToSearch.querySelectorAll('.market-group, .events-block-fastbet, .market, .bet-market, section[class*="bet"], [class*="market-block"], div.row[ng-repeat], div[class*="marketList"], .sc-market');
        marketBlocks.forEach(block => {
          const titleEl = block.querySelector('.market-title, .events-title-fastbet, h3, h4, .title, .market-name, [class*="title"], span.testo, span.sc-market-name, strong, b');
          const marketName = titleEl ? titleEl.textContent.trim() : '';
          if (!marketName || marketName.length > 50) return;

          block.querySelectorAll('button, .item-fastbet, .outcome, .odd, [class*="odd"], div[ng-click]').forEach(btn => {
            const spans = btn.querySelectorAll('span, p, b, strong, div');
            let label = '', oddsRaw = '';
            
            let texts = Array.from(spans).map(s => s.textContent.trim()).filter(t => t.length > 0);
            if (texts.length >= 2) {
              label    = texts[0];
              oddsRaw  = texts[texts.length - 1]; 
            } else {
               let split = btn.textContent.trim().split(/\s+/);
               if (split.length > 1) {
                  label = split[0];
                  oddsRaw = split[split.length-1];
               } else {
                  return; // no valid layout
               }
            }
            
            const odds = parseFloat(oddsRaw.replace(',', '.'));
            if (!isNaN(odds) && odds > 1) {
               out.push({ marketName, label, odds });
            }
          });
        });

        // METODO 3: Nuovo Layout Match Page (.bets-header-item)
        if (out.length === 0) {
            const headers = Array.from(nodeToSearch.querySelectorAll('.bets-header-item'));
            const oddsContainers = Array.from(nodeToSearch.querySelectorAll('.odds'));
            headers.forEach((header, index) => {
                const titleEl = header.querySelector('.bet-desc');
                const currentTitle = titleEl ? titleEl.textContent.trim() : '';
                if (!currentTitle) return;

                const labelEls = header.querySelectorAll('.odd-desc');
                const labels = Array.from(labelEls).map(el => el.textContent.trim());

                if (oddsContainers[index]) {
                     const oddEls = oddsContainers[index].querySelectorAll('.odd__value, .odd');
                     const oddVals = Array.from(oddEls).map(el => el.textContent.trim());
                     
                     labels.forEach((lab, j) => {
                         if (oddVals[j]) {
                              const odds = parseFloat(oddVals[j].replace(',', '.'));
                              const isComboTitle = currentTitle.includes('&') || currentTitle.toLowerCase().includes('esatto');
                              if (!isNaN(odds) && odds > 1 && !isComboTitle) {
                                  out.push({ marketName: currentTitle, label: lab, odds });
                              }
                         }
                     });
                }
            });
        }

        return out;
    };

    const allMarketData = clickedDropdown && clickedRowLocator 
      ? await clickedRowLocator.evaluate(domEvaluateFn)
      : await page.evaluate(domEvaluateFn);
      
    // Write full raw dump per Staryes match page (solo 3 vengono poi lette)
    import('fs').then(fs => {
         fs.writeFileSync('staryes_raw_debug.json', JSON.stringify(allMarketData, null, 2));
    });

    console.log(`[Staryes] Quote grezze estratte: ${allMarketData.length}`);
    if (allMarketData.length > 0) {
        console.log(`[Staryes] Esempio Raw Data:`, JSON.stringify(allMarketData.slice(0, 5)));
    }

    // Mappatura Nomi Interni
    for (const entry of allMarketData) {
      const lb = entry.label.toLowerCase().trim();
      const mn = entry.marketName.toLowerCase().trim();
      let direction = null, line = null, is1x2 = false;

      if (mn.includes('1x2') && !mn.includes('handicap')) {
        if (lb === '1' || lb === 'x' || lb === '2') { direction = lb.toUpperCase(); is1x2 = true; }
      } else if (mn.includes('doppia chance')) {
        if (lb === '1x' || lb === 'x2' || lb === '12') { direction = lb.toUpperCase(); is1x2 = true; }
      } else {
        const ovLb = lb.match(/^over\s*([\d.,]+)/i) || lb.match(/^ov\s*([\d.,]+)/i);
        const unLb = lb.match(/^under\s*([\d.,]+)/i) || lb.match(/^un\s*([\d.,]+)/i);
        const ovMn = mn.match(/over\s*([\d.,]+)/i);
        const unMn = mn.match(/under\s*([\d.,]+)/i);
        const numLb = lb.match(/([\d]+[.,][\d]+)/);
        const numMn = mn.match(/([\d]+[.,][\d]+)/);

        if (ovLb)           { direction = 'over';  line = ovLb[1]; }
        else if (unLb)      { direction = 'under'; line = unLb[1]; }
        else if (lb === 'over'  || lb === 'o') { direction = 'over';  line = numMn?.[1] || numLb?.[1] || null; }
        else if (lb === 'under' || lb === 'u') { direction = 'under'; line = numMn?.[1] || numLb?.[1] || null; }
        else if (ovMn)      { direction = 'over';  line = ovMn[1]; }
        else if (unMn)      { direction = 'under'; line = unMn[1]; }
        else if (mn.includes('over/under') || mn.includes('u/o')) {
          if (lb.startsWith('o') || lb.includes('over'))  direction = 'over';
          if (lb.startsWith('u') || lb.includes('under')) direction = 'under';
          line = numMn?.[1] || numLb?.[1] || null;
        }
      }

      if (!direction || (!line && !is1x2)) continue;

      const mappingKey = `${mn} ${lb}`.toLowerCase();
      const internalName = mapMarketName(mappingKey, line, direction, SPORTBET_MARKET_MAP, homeTeam, awayTeam);
      
      if (!internalName || internalName.includes('ignorato')) continue;

      if (!results[internalName]) results[internalName] = {};
      // NON sovrascrivere: la prima quota trovata è quella corretta (il titolo con linea esplicita viene prima).
      if (results[internalName].sportium === undefined) {
        results[internalName].sportium = entry.odds;
      }
    }

    console.log(`[Staryes] Mercati mappati per output (chiave compatibilità 'sportium'): ${Object.keys(results).length}`);

  } catch (e) {
    errors.push(`Staryes errore critico: ${e.message}`);
    console.error(`[Staryes] Errore:`, e.message);
  }

  return { odds: results, errors };
}
// ─── Scraper Sportbet ─────────────────────────────────────────────────────────
async function scrapeSportbet(page, league, homeTeam, awayTeam) {
  const results = {};
  const errors = [];

  try {
    // PASSAGGIO 1: vai su sportbet.it
    console.log(`[Sportbet] Step 1: Navigo su https://www.sportbet.it/`);
    await page.goto('https://www.sportbet.it/', { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await dismissCookies(page);

    // PASSAGGIO 2: clicca su SPORT (più o meno in alto a sinistra)
    console.log(`[Sportbet] Step 2: Clicco su SPORT`);
    try {
      const sportLink = page.locator('a.altro-principale:has-text("SPORT"), header a:has-text("SPORT"), .top-menu a:has-text("SPORT"), a:has-text("SCOMMESSE")').first();
      if (await sportLink.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await sportLink.click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
        await dismissCookies(page);
      } else {
         console.log(`[Sportbet] ⚠ Bottone SPORT non visibile. Forse siamo già nella sezione sport.`);
      }
    } catch(e) { console.log(`[Sportbet] Errore su click SPORT: ${e.message}`); }

    // PASSAGGIO 3: trova il campionato della partita (più o meno al centro o sidebar)
    const leagueSlugs = { 
        SerieA: 'serie-a', 
        Premier: 'premier-league', 
        LaLiga: 'liga', 
        Ligue1: 'ligue-1', 
        Bundes: 'bundesliga' 
    };
    const slug = leagueSlugs[league] || league.toLowerCase();
    console.log(`[Sportbet] Step 3: Clicco campionato tramite slug "${slug}" o nome "${league}"`);
    
    let clickedLeague = false;
    try {
        // Cerca per link href oppure per testo esplicito per gestire "LaLiga" / "La Liga" / "Prima Divisione"
        const isLiga = league === 'LaLiga';
        const locatorStr = isLiga 
           ? `a[href*="/liga"], a:has-text("LaLiga"), a:has-text("La Liga"), a[href*="laliga"]` 
           : `a[href*="/${slug}"], a:has-text("${league}"), a:has-text("${league.substring(0, 5)}")`;
           
        // Attesa esplicita per permettere al framework frontend (Angular) di popolare i dati
        await page.waitForSelector(locatorStr, { timeout: 8000 }).catch(() => null);

        const potentialLeagues = await page.locator(locatorStr).all();
        console.log(`[Sportbet] Trovati ${potentialLeagues.length} potenziali link per il campionato.`);
        for (const link of potentialLeagues) {
           if (await link.isVisible().catch(()=>false)) {
               try {
                   const href = await link.getAttribute('href').catch(()=>'');
                   if (href && (href.startsWith('http') || href.startsWith('/'))) {
                       await link.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(()=>null);
                       await link.click({ timeout: 4000, force: true });
                       await page.waitForLoadState('load');
                       await page.waitForTimeout(4000);
                       clickedLeague = true;
                       console.log(`[Sportbet] ✅ Campionato cliccato con successo!`);
                       break;
                   }
               } catch(e) {}
           }
        }
    } catch(e) { console.log(`[Sportbet] Errore iterazione link campionato: ${e.message}`); }

    if (!clickedLeague) {
       console.log(`[Sportbet] ⚠ Nessun click al Campionato andato a buon fine, procedo sperando sia visibile a schermo.`);
       // Prova navigazione diretta come salva-vita
       await page.goto(`https://www.sportbet.it/scommesse/sport/calcio/${slug}`, { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(()=>null);
       await page.waitForTimeout(4000);
    }

    // PASSAGGIO 4: trova la partita da analizzare e clicca la tendina
    console.log(`[Sportbet] Step 4: Cerco la partita "${homeTeam} - ${awayTeam}" e la tendina a comparsa`);
    await page.waitForTimeout(3000); // Extra tempo affinché la pagina del campionato renderizzi tutte le tabelle match
    
    const rowSearchRegex = buildMatchSearchRegex(homeTeam, awayTeam);
    // Prendiamo div o tr (macro-righe) invece delle foglie, perché la tendina è nella riga!
    const potentialRows = await page.locator(`div, tr, li`).filter({ hasText: rowSearchRegex }).all();
    
    let validRows = [];
    let clickedRowLocator = null;
    
    for (const row of potentialRows) {
      const text = (await row.textContent().catch(() => '')).trim();
      // Le righe spesso contengono markup SVG/CSS raw che le allungano a ~600-800 caratteri
      if (text && text.length > 10 && text.length < 2500 && matchesFixture(text, homeTeam, awayTeam)) {
         validRows.push({ row, text, len: text.length });
      }
    }

    if (validRows.length > 0) {
        // Ordiniamo per lunghezza -> le prime sono i contenitori più specifici che avvolgono tutto il match
        validRows.sort((a, b) => a.len - b.len);
        let clickedDropdown = false;

        for (let rowObj of validRows) {
           const triangleBtn = rowObj.row.locator('.fa-caret-square-down, [id^="apri-fastbet"]').first();
           if (await triangleBtn.isVisible().catch(()=>false)) {
               console.log(`[Sportbet] ✅ Trovata tendina verticale Fastbet (triangolino scuro)!`);
               try {
                   clickedRowLocator = rowObj.row;
                   await triangleBtn.scrollIntoViewIfNeeded().catch(()=>null);
                   
                   // Usa ESCLUSIVAMENTE un solo click basato sulle coordinate per evitare doppi click 
                   // che finirebbero per richiudere la tendina (essendo un toggle che aspetta AJAX).
                   const box = await triangleBtn.boundingBox();
                   if (box) {
                       await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 150 });
                   } else {
                       await triangleBtn.click({ force: true, timeout: 2000 }).catch(()=>null);
                   }
                   
                   clickedDropdown = true;
                   await page.waitForTimeout(4000); // attendi completamento rendering dati AJAX
                   break;
               } catch(e) { console.log(`Errore su click dropdown verticale: ${e}`); }
           }
        }

        if (!clickedDropdown) {
             console.log(`[Sportbet] ❌ Bottone tendina non trovato, clicco l'intera riga per entrare nella pagina singola...`);
             await validRows[0].row.scrollIntoViewIfNeeded().catch(()=>null);
             await validRows[0].row.click({ timeout: 4000, force: true }).catch(()=>null);
             await page.waitForLoadState('domcontentloaded');
             await page.waitForTimeout(3000);
        }
    } else {
        console.log(`[Sportbet] ❌ Nessuna riga corrispondente a "${homeTeam} vs ${awayTeam}" trovata`);
        errors.push(`Sportbet: partita "${homeTeam} vs ${awayTeam}" non trovata`);
        return { odds: results, errors };
    }

    // PASSAGGIO 5: Estrapola le quote.
    // Se siamo nella tendina le avremo già tutte, altrimenti potremmo essere finiti nella pagina match (tenteremo pure i tab)
    console.log(`[Sportbet] Step 5: Estrapolazione delle quote visibili...`);
    const tabsToClick = [ /under ?\/ ?over/i, /^squadre$/i, /^statistiche partita$/i, /^corner$/i, /^sanzioni$/i ];
    const allMarketData = [];
    
    // Tentiamo di eseguire l'estrazione ALMENO UNA VOLTA nella vista attuale (che è la tendina o la vista principale)
    // Se ci sono i tab (es. pagina match), li clicchiamo. Altrimenti li skippiamo.
    const isTabbedView = await page.locator(`button, a, li, span.testoNav`).filter({ hasText: tabsToClick[0] }).isVisible().catch(()=>false);

    const extractCurrentOdds = async (isFastbet = false) => {
         // Espandi eventuali fisarmoniche interne: SOLO se non stiamo leggendo la tendina fastbet (altrimenti si chiude al click altrove)
         if (!isFastbet) {
             const expandBtns = await page.locator('button[aria-expanded="false"], .accordion-toggle, div[class*="expand"] .fas.fa-plus').all();
             for (const btn of expandBtns) {
                 try { await btn.click({ timeout: 1000 }); } catch { /* ignore */ }
             }
             await page.waitForTimeout(500);
         }

         const domEvaluateFn = (rootNode) => {
            const nodeToSearch = rootNode || document;
            const out = [];

            // METODO 1: Layout a tendina Sportbet (Fastbet list)
            const fastbetLists = nodeToSearch.querySelectorAll('.lista-quote-interna-fastbet');
            if (fastbetLists.length > 0) {
                fastbetLists.forEach(list => {
                    const items = list.querySelectorAll('li');
                    items.forEach(li => {
                        const titleEl = li.querySelector('span.grassetto');
                        if (!titleEl) return;
                        const currentTitle = titleEl.textContent.trim();
                        
                        const oddsElements = li.querySelectorAll('.fast-bets-odd');
                        oddsElements.forEach(oddEl => {
                            const text = oddEl.textContent.trim(); // "UNDER : 7.00" or "OVER (PlayerName/0.5) : 2.91"
                            // Trova l'ULTIMO ':' per gestire label con ':' interno (es: nomi di giocatori)
                            const colonIdx = text.lastIndexOf(':');
                            if(colonIdx < 0) return;
                            const label = text.substring(0, colonIdx).trim();
                            const oddsStr = text.substring(colonIdx + 1).trim();
                            const odds = parseFloat(oddsStr.replace(',','.'));
                            
                            // FILTRO CHIAVE: label di mercato validi sono CORTI e SENZA parentesi e SENZA '+'
                            // Es: "UNDER", "OVER", "SI", "NO", "1", "X", "2", "1X", "12"
                            // Le prop-giocatore hanno label tipo: "OVER (Rossi Mario/1.5)" o "SI (Rossi Mario)"
                            // Le combo hanno label tipo: "1+2", "UNDER+OVER", "X+X+2"
                            const isPlayerPropLabel = label.includes('(') || label.includes(')') || label.includes('+') || label.length > 25;
                            
                            // Escludi anche titoli di mercati combo/esatti/speciali/parziali per sicurezza
                            const isComboTitle = currentTitle.includes('&') || 
                                                 currentTitle.includes('+') ||
                                                 currentTitle.toLowerCase().includes('esatti') ||
                                                 currentTitle.toLowerCase().includes('multigol') ||
                                                 currentTitle.toLowerCase().includes('ht/ft') ||
                                                 currentTitle.toLowerCase().includes('gol plus') ||
                                                 currentTitle.toLowerCase().includes('almeno') ||
                                                 currentTitle.toLowerCase().includes('p/d ') ||
                                                 currentTitle.toLowerCase().includes('ris.') ||
                                                 currentTitle.toLowerCase().includes('risultato esatto') ||
                                                 currentTitle.toLowerCase().includes(' tempo') ||
                                                 currentTitle.toLowerCase().includes('°tempo') ||
                                                 currentTitle.toLowerCase().includes(' ah ') ||
                                                 (currentTitle.includes('(') && !currentTitle.toLowerCase().includes('numero cartellini'));
                            
                            if(!isNaN(odds) && odds > 1 && currentTitle.length <= 60 && !isPlayerPropLabel && !isComboTitle) {
                                out.push({ marketName: currentTitle, label, odds });
                            }
                        });
                    });
                });
            }

            // Se ha trovato roba col nuovo metodo tendina, probabilmente basta.
            if (out.length > 5) return out;

            // METODO 2: Blocchi di layout classici/match page (fallback)
            const marketBlocks = nodeToSearch.querySelectorAll('.market-group, .market, .bet-market, section[class*="bet"], [class*="market-block"], div.row[ng-repeat], div[class*="marketList"], .sc-market');
            marketBlocks.forEach(block => {
              const titleEl = block.querySelector('h3, h4, .title, .market-name, [class*="title"], span.testo, span.sc-market-name, strong, b');
              let marketName = titleEl ? titleEl.textContent.trim() : '';
              
              if (!marketName || marketName.length > 50) return;

              const buttons = block.querySelectorAll('button, .outcome, .odd, [class*="odd"], div[ng-click]');
              buttons.forEach(btn => {
                const spans = btn.querySelectorAll('span, p, b, strong, div');
                let label = '', oddsRaw = '';
                
                let texts = Array.from(spans).map(s => s.textContent.trim()).filter(t => t.length > 0);
                if (texts.length >= 2) {
                  label    = texts[0];
                  oddsRaw  = texts[texts.length - 1]; 
                } else {
                   let split = btn.textContent.trim().split(/\s+/);
                   if (split.length > 1) {
                      label = split[0];
                      oddsRaw = split[split.length-1];
                   }
                }
                
                const odds = parseFloat(oddsRaw.replace(',', '.'));
                if (!isNaN(odds) && odds > 1) {
                  out.push({ marketName, label, odds });
                }
              });
            });
            return out;
         };

         // Valuta l'estrazione sull'intero document per evitare timeout se la riga originaria cambia referenza nel DOM
         return await page.evaluate(domEvaluateFn, null);
    };

    if (isTabbedView) {
        for (const tabPattern of tabsToClick) {
           const tabBtn = page.locator(`button, a, li, span.testoNav`).filter({ hasText: tabPattern }).first();
           if (await tabBtn.isVisible({ timeout: 2000 }).catch(()=>false)) {
               console.log(`[Sportbet] Clicco tab: ${tabPattern}`);
               await tabBtn.click();
               await page.waitForTimeout(1500); 
               allMarketData.push(...await extractCurrentOdds());
           }
        }
    } else {
        console.log(`[Sportbet] Estrazione lista verticale compatta dalla tendina...`);
        // La lista verticale mostra tutto srotolato, non serve iterare sulle macro-categorie in orizzontale
        const catOdds = await extractCurrentOdds(true); // passa true per isolare l'estrazione nella riga e saltare click accordion
        allMarketData.push(...catOdds);
    }

    console.log(`[Sportbet] Quote grezze estratte: ${allMarketData.length}`);

    // Mappatura Nomi Interni
    for (const entry of allMarketData) {
      let direction = null;
      const lb = entry.label.toLowerCase();
      const mn = entry.marketName.toLowerCase();
      
      let is1x2 = false;
      if (mn.includes('1x2') && !mn.includes('handicap')) {
          if (lb === '1' || lb === 'x' || lb === '2') {
              direction = lb.toUpperCase();
              is1x2 = true;
          }
      } else {
          // 1. Identifica Direzione (Over/Under)
          if (lb.includes('over') || lb === 'o') direction = 'over';
          else if (lb.includes('under') || lb === 'u') direction = 'under';
          
          if (!direction) {
              if (mn.includes('over')) direction = 'over';
              else if (mn.includes('under')) direction = 'under';
              
              // Se la stringa indica genericamente U/O, deduciamo dal label
              if (!direction && (mn.includes('u/o') || mn.includes('o/u'))) {
                  if (lb.includes('over') || lb.startsWith('o')) direction = 'over';
                  else if (lb.includes('under') || lb.startsWith('u')) direction = 'under';
              }
          }
      }

      // 2. Identifica la Linea Numerica (es. 2.5, 3.5) ovunque sia
      let lineMatch = entry.label.match(/[\d]+[.,][\d]+/) || entry.marketName.match(/[\d]+[.,][\d]+/);
      let line = lineMatch ? lineMatch[0] : null;

      // Accettiamo se è un mercato Under/Over con linea numerica, OPPURE se è un 1X2 valido
      if (!direction || (!line && !is1x2)) continue;

      const internalName = mapMarketName(entry.marketName, line, direction, SPORTBET_MARKET_MAP, homeTeam, awayTeam);
      if (!internalName) continue;

      if (!results[internalName]) results[internalName] = {};
      // NON sovrascrivere: la prima quota trovata è quella corretta.
      if (results[internalName].sportbet === undefined) {
        results[internalName].sportbet = entry.odds;
      }
    }

  } catch (e) {
    errors.push(`Sportbet errore critico: ${e.message}`);
  }

  return { odds: results, errors };
}

// ─── Calcolo Value Bet ────────────────────────────────────────────────────────
/**
 * Incrocia le quote scraped con le probabilità calcolate dal motore statistico.
 * Restituisce la lista di value bet con Edge positivo ≥ minEdge.
 *
 * @param {Object} scrapedOdds   - { "OVER 2,5 GOL": { sportium: 1.85, sportbet: 1.90 }, ... }
 * @param {Array}  markets       - Array dei mercati con probability da /api/analysis
 * @param {number} minEdge       - Soglia minima di edge (default 0.20)
 * @returns {Array}              - Lista { marketName, bookmaker, odds, probability, edge }
 */
export function computeValueBets(scrapedOdds, markets, minEdge = 0.20) {
  const valueBets = [];

  for (const market of markets) {
    if (market.isDiscarded) continue;
    const oddsForMarket = scrapedOdds[market.name];
    if (!oddsForMarket) continue;

    const prob = market.probability;

    for (const [book, oddsVal] of Object.entries(oddsForMarket)) {
      if (!oddsVal || oddsVal <= 1) continue;
      const edge = (prob * oddsVal) - 1;
      if (edge >= minEdge) {
        valueBets.push({
          marketName:  market.name,
          category:    market.category,
          bookmaker:   book,
          odds:        oddsVal,
          probability: prob,
          edge:        Math.round(edge * 10000) / 10000,
          fairOdds:    market.fairOdds,
          minOdds:     market.minOdds,
        });
      }
    }
  }

  // Ordina per edge decrescente
  return valueBets.sort((a, b) => b.edge - a.edge);
}

// ─── Entry point principale ───────────────────────────────────────────────────
/**
 * Lancia Chromium headless, scrapa entrambi i bookmaker e restituisce i risultati unificati.
 *
 * @param {string} league       - ID campionato (es. "SerieA")
 * @param {string} homeTeam     - Nome squadra casa
 * @param {string} awayTeam     - Nome squadra ospite
 * @param {Array}  markets      - Mercati con probabilità dal motore statistico
 * @param {number} minEdge      - Soglia minima edge
 * @returns {Object} { odds, valueBets, errors, scrapedAt }
 */
export async function scrapeBothBooks(league, homeTeam, awayTeam, markets = [], minEdge = 0.20) {
  const allErrors = [];

  try {
    // ── BROWSER 1: Sportium — usa Chrome HEADFUL ──────────────────────────────
    // Sportium usa rilevamento headless very aggressivo a livello SPA: il componente
    // Angular che renderizza la lista partite e la sidebar leghe non monta mai in
    // headless mode (neanche con Chrome reale + stealth completo).
    // Soluzione: headless: false (finestra Chrome visibile, minimizzata).
    let sportiumOdds = {};
    let browserSportium = null;
    try {
      try {
        browserSportium = await chromium.launch({
          channel: 'chrome',
          headless: false,   // ← HEADFUL: unico modo per far renderizzare Angular
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
            '--window-position=0,0',
          ],
        });
        console.log('[Scraper] Sportium: Chrome headful (channel:chrome)');
      } catch {
        browserSportium = await chromium.launch({
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
          ],
        });
        console.log('[Scraper] Sportium: Chromium headful (fallback)');
      }

      const ctx1 = await browserSportium.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'it-IT',
        timezoneId: 'Europe/Rome',
      });
      await ctx1.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        if (!window.chrome) window.chrome = { runtime: {} };
      });
      const page1 = await ctx1.newPage();
      page1.setDefaultTimeout(WAIT_TIMEOUT);
      const sportiumResult = await scrapeSportium(page1, league, homeTeam, awayTeam);
      sportiumOdds = sportiumResult.odds;
      allErrors.push(...sportiumResult.errors);
      
      console.log('[Scraper] Chiudo Context Sportium...');
      await ctx1.close().catch(()=>null);
      console.log('[Scraper] Context chiusa.');
    } catch (e) {
      allErrors.push(`Sportium: errore imprevisto — ${e.message}`);
      console.error('[Sportium] Errore:', e.message);
    } finally {
      if (browserSportium) {
        try { 
          console.log('[Scraper] Chiudo browser completo Sportium...');
          await Promise.race([
              browserSportium.close(),
              new Promise(res => setTimeout(res, 2000))
          ]);
          console.log('[Scraper] Browser Sportium chiuso.');
        } catch { 
           try { browserSportium.process().kill('SIGKILL'); } catch {}
        }
      }
    }

    // ── BROWSER 2: Sportbet — headless (funziona già bene) ────────────────────
    let sportbetOdds = {};
    let browserSportbet = null;
    try {
      try {
        browserSportbet = await chromium.launch({
          channel: 'chrome',
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
          ],
        });
        console.log('[Scraper] Sportbet: Chrome headful');
      } catch {
        browserSportbet = await chromium.launch({
          headless: false,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
          ],
        });
        console.log('[Scraper] Sportbet: Chromium headful (fallback)');
      }

      const ctx2 = await browserSportbet.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'it-IT',
        timezoneId: 'Europe/Rome',
        extraHTTPHeaders: {
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        },
      });
      await ctx2.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
        if (!window.chrome) window.chrome = { runtime: {} };
      });
      const page2 = await ctx2.newPage();
      page2.setDefaultTimeout(WAIT_TIMEOUT);
      const sportbetResult = await scrapeSportbet(page2, league, homeTeam, awayTeam);
      sportbetOdds = sportbetResult.odds;
      allErrors.push(...sportbetResult.errors);
      await ctx2.close();
    } catch (e) {
      allErrors.push(`Sportbet: errore imprevisto — ${e.message}`);
    } finally {
      if (browserSportbet) {
        try { 
           console.log('[Scraper] Chiudo browser completo Sportbet...');
           await Promise.race([
               browserSportbet.close(),
               new Promise(res => setTimeout(res, 2000))
           ]);
           console.log('[Scraper] Browser Sportbet chiuso.');
        } catch { 
           try { browserSportbet.process().kill('SIGKILL'); } catch {}
        }
      }
    }

    // ── Unifica quote ──
    const combinedOdds = {};
    const allMarketNames = new Set([
      ...Object.keys(sportiumOdds),
      ...Object.keys(sportbetOdds)
    ]);

    for (const name of allMarketNames) {
      combinedOdds[name] = {};
      if (sportiumOdds[name]?.sportium) combinedOdds[name].sportium = sportiumOdds[name].sportium;
      if (sportbetOdds[name]?.sportbet)  combinedOdds[name].sportbet  = sportbetOdds[name].sportbet;
    }

    // ── Value Bet ──
    const valueBets = computeValueBets(combinedOdds, markets, minEdge);

    return {
      success:    true,
      odds:       combinedOdds,
      valueBets,
      errors:     allErrors,
      scrapedAt:  new Date().toISOString(),
      stats: {
        marketsSportium: Object.keys(sportiumOdds).length,
        marketsSportbet:  Object.keys(sportbetOdds).length,
        marketsTotal:     Object.keys(combinedOdds).length,
        valueBetsFound:   valueBets.length,
      },
    };

  } catch (e) {
    allErrors.push(`Errore critico scraper: ${e.message}`);
    console.error('[Scraper] Errore critico:', e.message);
    return { success: false, odds: {}, valueBets: [], errors: allErrors, scrapedAt: new Date().toISOString() };
  }
}

