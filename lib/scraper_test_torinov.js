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
  '1x2 tiri in porta':    (line, dir) => `1X2 TIRI IN PORTA: ${dir}`,
  '1x2 tiri totali':      (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 tiri':             (line, dir) => `1X2 TIRI: ${dir}`,
  '1x2 corner':           (line, dir) => `1X2 CORNER: ${dir}`,
  '1x2 cartellini squadre': (line, dir) => `1X2 CARTELLINI: ${dir}`,
  '1x2 cartellini':       (line, dir) => `1X2 CARTELLINI: ${dir}`,
  '1x2 falli':            (line, dir) => `1X2 FALLI: ${dir}`,

  // ── GOL SQUADRA ─────────────────────────────────────────────────────────────
  // Mapper sostituisce "squadra  1/2" con "casa/ospite" PRIMA di cercare qui.
  // Quindi servono ENTRAMBE le forme: originale e post-sostituzione.

  'squadra  1':           (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  'squadra  2':           (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,
  'squadra 1':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  'squadra 2':            (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,

  // ── TIRI IN PORTA ───────────────────────────────────────────────────────────
  'tiri in porta team 1': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA CASA`,
  'tiri in porta team 2': (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA OSPITE`,
  'tiri in porta':        (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI IN PORTA TOTALI`,

  // ── TIRI TOTALI ─────────────────────────────────────────────────────────────
  'tiri totali team1':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI CASA`,
  'tiri totali team2':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI OSPITE`,
  'tiri totali':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} TIRI TOTALI`,

  // ── CORNER ──────────────────────────────────────────────────────────────────
  // Titolo originale: "UNDER/OVER 3.5 CORNER SQUADRA  1"
  // Dopo sostituzione mapper: "under/over 3.5 corner casa"
  // → servono ENTRAMBE le forme nella mappa!
  'corner squadra  1':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,
  'corner squadra  2':    (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`,
  'corner squadra 1':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,
  'corner squadra 2':     (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`,
  'corner casa':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER CASA`,   // forma post-sostituzione
  'corner ospite':        (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER OSPITE`, // forma post-sostituzione
  'corner t.r.':          (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,
  'corner':               (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CORNER TOTALI`,

  // ── CARTELLINI ──────────────────────────────────────────────────────────────
  'numero cartellini team x': (line, dir, labelStr) => {
      if (labelStr.endsWith(' 1')) return `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI CASA`;
      if (labelStr.endsWith(' 2')) return `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI OSPITE`;
      return null;
  },
  'cartellini incontro':  (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,
  'cartellini':           (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} CARTELLINI TOTALI`,
  // ── PARATE ──────────────────────────────────────────────────────────────────
  'parate team': (line, dir, labelStr) => {
      if (labelStr.endsWith(' 1')) return `${dir.toUpperCase()} ${formatLine(line)} PARATE CASA`;
      if (labelStr.endsWith(' 2')) return `${dir.toUpperCase()} ${formatLine(line)} PARATE OSPITE`;
      return `${dir.toUpperCase()} ${formatLine(line)} PARATE TOTALI`;
  },
  'parate':               (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} PARATE TOTALI`,

  // ── GOL TOTALI E GOL SQUADRA (generico – sempre alla fine) ──────────────────
  ' casa':                (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL CASA`,
  ' ospite':              (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL OSPITE`,
  'u/o':                  (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL`,
  'o/u':                  (line, dir) => `${dir.toUpperCase()} ${formatLine(line)} GOL`,
};

// ─── Utility ──────────────────────────────────────────────────────────────────
/**
 * Formatta la linea come "X,5" per le intere o "X" per i float.
 * Es: 2.5 → "2,5" | 3 → "3,5" (perché le linee di mercato sono X,5)
 */
function formatLine(line) {
  const n = parseFloat(line);
  if (isNaN(n)) return String(line);
  if (n % 1 === 0) return `${n},5`;
  return `${Math.floor(n)},5`;
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
function tokenize(name) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // rimuovi diacritici
    .replace(/[^a-z0-9\s]/g, ' ')      // sostituisci non-alfanumerico con spazio
    .trim();

  return base
    .split(/\s+/)
    .filter(t => t.length > 0 && !NOISE_WORDS.includes(t));
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
  // Split sul separatore comune vs / - per isolare le due squadre nel testo
  // Prova prima a splittare, poi fai il test su ogni metà
  const separators = [' vs ', ' - ', ' v ', ' — ', '\n'];
  let textHome = text, textAway = text;
  for (const sep of separators) {
    const parts = text.split(sep);
    if (parts.length >= 2) {
      textHome = parts[0];
      textAway = parts[parts.length - 1];
      break;
    }
  }

  const hMatchDirect = fuzzyTeamMatch(homeTeam, textHome) || fuzzyTeamMatch(homeTeam, text);
  const aMatchDirect = fuzzyTeamMatch(awayTeam, textAway) || fuzzyTeamMatch(awayTeam, text);

  if (hMatchDirect && aMatchDirect) return true;

  // Fallback: prova anche ordine invertito (bookmaker potrebbe mettere ospite prima)
  const hMatchInv = fuzzyTeamMatch(homeTeam, textAway) || fuzzyTeamMatch(homeTeam, text);
  const aMatchInv = fuzzyTeamMatch(awayTeam, textHome) || fuzzyTeamMatch(awayTeam, text);
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
    // Blocca mercati parziali (1°/2° tempo), combo e player-props
    // NOTE: NON aggiungere 't.r', 'ts', 'inc.ts' — usati in titoli legittimi Sportbet
    'ht/ft', 'parziale', ' tempo', '°tempo', 'doppia chance 1', 'doppia chance 2',
    '1/1', '1/x', '1/2', 'x/1', 'x/x', 'x/2', '2/1', '2/x', '2/2',
    'multigol', 'margine', 'combo', 'minuto', 'sanzioni', 'ribaltone', 'doppietta', 'metodo', 'ribalta',
    'pari/dispari', 'plus', 'rigore', 'var', 'palo', 'traversa', 'valore',
    'giocatore', 'sostituto', 'assist', 'marcatore', 'segna', 'panchina',
  ];
  for (const kw of invalidKeywords) {
      // Usiamo una regex per catturare '1T' come parola isolata o suffisso, per sicurezza
      const kwRegex = new RegExp(`(?:\\b|_|\\s)${kw.replace(/[+°/.]/g, '\\$&')}(?:\\b|_|\\s|$)`, 'i');
      if (kwRegex.test(label) || label.includes(kw)) return null;
  }

  // Sostituire riferimenti espliciti alle squadre elaborando doppi spazi es: "SQUADRA  1"
  let unifiedLabel = label.replace(/squadra\s+1/g, 'casa').replace(/squadra\s+2/g, 'ospite');
  
  // Sostituiamo anche eventuali riferimenti diretti ai nomi delle squadre (es. "U/O 5.5 TIRI IN PORTA CAGLIARI")
  if (hTeam && unifiedLabel.includes(hTeam)) {
      unifiedLabel += ' casa';
  } else if (aTeam && unifiedLabel.includes(aTeam)) {
      unifiedLabel += ' ospite';
  } else {
      // In caso di nomi parziali (es. "Hellas" per Hellas Verona)
      if (hTeam && hTeam.length > 4 && unifiedLabel.includes(hTeam.substring(0, 5))) unifiedLabel += ' casa';
      if (aTeam && aTeam.length > 4 && unifiedLabel.includes(aTeam.substring(0, 5))) unifiedLabel += ' ospite';
  }
  
  for (const [pattern, fn] of Object.entries(marketMap)) {
    if (unifiedLabel.includes(pattern)) {
      return fn(line, direction, unifiedLabel);
    }
  }
  return null;
}

// ─── Scraper Sportium ─────────────────────────────────────────────────────────
async function scrapeSportium(page, league, homeTeam, awayTeam) {
  const results = {};
  const errors = [];

  try {
    // 1. Definiamo i percorsi esatti per nazione/lega
    const leaguePaths = {
        'SerieA':  'italia/serie-a',
        'Premier': 'inghilterra/premier-league',
        'LaLiga':  'spagna/la-liga',
        'Ligue1':  'francia/ligue-1',
        'Bundes':  'germania/bundesliga'
    };
    const regionPath = leaguePaths[league] || `italia/${league.toLowerCase()}`;
    let navigated = false;

    // Strategia 1: URL Diretto
    try {
        const directUrl = `https://www.sportium.it/scommesse/calcio/${regionPath}`;
        console.log(`[Sportium] Navigazione diretta: ${directUrl}`);
        await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        navigated = true;
    } catch {
        console.log(`[Sportium] URL diretto fallito...`);
    }

    // Strategia 2: Navigazione via menù (Fallback rapido)
    if (!navigated || (page.url().includes('scommesse') && !page.url().includes(regionPath.split('/')[1]))) {
        console.log(`[Sportium] Navigazione campionato via menù per ${league}...`);
        try {
            await page.goto('https://www.sportium.it/scommesse', { waitUntil: 'domcontentloaded' });
            const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonDecline, button:has-text("Rifiuta")').first();
            if (await cookieBtn.isVisible({ timeout: 3000 })) await cookieBtn.click();

            const calcioMenu = page.locator('span, a').filter({ hasText: /^calcio$/i }).first();
            await calcioMenu.click({ timeout: 3000 }).catch(()=>null);
            
            const leagueLink = page.locator(`a[href*="/${regionPath.split('/')[1]}"], a:has-text("${league}"), a:has-text("Liga")`).first();
            if (await leagueLink.isVisible({ timeout: 5000 }).catch(()=>false)) {
                await leagueLink.click();
                await page.waitForTimeout(3000);
            }
        } catch (err) {
            console.log(`[Sportium] Errore fallback menù: ${err.message}`);
        }
    }
    
    console.log(`[Sportium] URL attuale: ${page.url()}`);

    // Accetta cookie se presenti (potrebbero bloccare il rendering)
    try {
      const cookieBtn = page.locator('button:has-text("Rifiuta"), button:has-text("Accetta"), button[id*="cookie"]').first();
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        await page.waitForTimeout(2000);
      }
    } catch {}
    
    // Attendi che i match si carichino (Angular SPA)
    await page.waitForTimeout(4000);

    // Identifica la partita — cerca in tutti gli elementi che potrebbero contenere un nome di squadra
    const links = await page.locator('a, .team-name, [class*="team"], [class*="event"], [class*="match"], [class*="fixture"]').all();
    let matchLink = null;
    let debugTexts = [];
    for (const link of links) {
      const text = await link.textContent().catch(() => '');
      const trimmed = text.trim();
      if (trimmed.length > 5 && trimmed.length < 150) {
        if (debugTexts.length < 10) debugTexts.push(trimmed.substring(0, 80));
        if (matchesFixture(trimmed, homeTeam, awayTeam)) {
          console.log(`[Sportium] ✅ Match trovato: "${trimmed}"`);
          matchLink = link;
          break;
        }
      }
    }
    if (debugTexts.length > 0) console.log(`[Sportium] Primi testi trovati:`, debugTexts);

    if (!matchLink) {
      console.log(`[Sportium] ❌ Nessun match per "${homeTeam} vs ${awayTeam}"`);
      errors.push(`Sportium: partita "${homeTeam} vs ${awayTeam}" non trovata nella pagina`);
      return { odds: results, errors };
    }

    // Naviga sulla pagina della partita
    await matchLink.click();
    await page.waitForTimeout(PAGE_LOAD);
    await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});

    // Espandi tutti i mercati disponibili
    try {
      const expandBtns = page.locator('[data-qa*="expand"], button[aria-expanded="false"], .market-toggle');
      const count = await expandBtns.count();
      for (let i = 0; i < count; i++) {
        try { await expandBtns.nth(i).click({ timeout: 2000 }); } catch { /* ignora */ }
      }
      await page.waitForTimeout(1000);
    } catch { /* ignore */ }

    // Estrai quote: struttura Sportium
    // Mercati → Selezioni (Over/Under con linea e quota)
    const marketData = await page.evaluate(() => {
      const out = [];

      // Prova struttura comune dei siti di scommesse spagnoli
      const marketBlocks = document.querySelectorAll(
        '.market, [data-qa="market"], .bet-group, .odds-group, section[class*="market"]'
      );

      marketBlocks.forEach(block => {
        const titleEl = block.querySelector(
          '.market-header, .market-title, [data-qa="market-name"], h3, h4, .group-title'
        );
        const marketName = titleEl ? titleEl.textContent.trim() : '';
        if (!marketName) return;

        const selections = block.querySelectorAll(
          '.selection, [data-qa="selection"], .odd-btn, .bet-button, button[data-odds]'
        );

        selections.forEach(sel => {
          const labelEl = sel.querySelector('.selection-name, .odd-label, [data-qa="selection-name"], span:first-child');
          const oddsEl  = sel.querySelector('.odds, .odd-value, [data-qa="odds"], .price, span:last-child');
          const label   = labelEl ? labelEl.textContent.trim() : sel.textContent.trim();
          const oddsRaw = oddsEl  ? oddsEl.textContent.trim()  : '';
          const odds    = parseFloat(oddsRaw.replace(',', '.'));
          if (!isNaN(odds) && odds > 1) {
            out.push({ marketName, label, odds });
          }
        });
      });

      return out;
    });

    // Mappa ai nomi interni
    for (const entry of marketData) {
      // Prova a identificare linea e direzione
      const ovMatch  = entry.label.match(/over\s*([\d,.]+)/i);
      const unMatch  = entry.label.match(/under\s*([\d,.]+)/i);
      const lineMatch = entry.marketName.match(/[\d]+[.,][\d]+/);

      let direction = null;
      let line = null;
      const lblLower = entry.label.toLowerCase();
      const mnLower = entry.marketName.toLowerCase();
      
      let is1x2 = false;
      if (mnLower.includes('1x2')) {
          if (lblLower === '1' || lblLower === 'x' || lblLower === '2') {
              direction = lblLower.toUpperCase();
              is1x2 = true;
          }
      } else {
          direction = ovMatch ? 'over' : unMatch ? 'under' : null;
          line = ovMatch?.[1] || unMatch?.[1] || lineMatch?.[0] || null;
      }

      if (!direction || (!line && !is1x2)) continue;

      const internalName = mapMarketName(entry.marketName, line, direction, SPORTIUM_MARKET_MAP, homeTeam, awayTeam);
      if (!internalName) continue;

      if (!results[internalName]) results[internalName] = {};
      // Tieni la quota più alta disponibile se duplicata
      if (!results[internalName].sportium || entry.odds > results[internalName].sportium) {
        results[internalName].sportium = entry.odds;
      }
    }

  } catch (e) {
    errors.push(`Sportium errore critico: ${e.message}`);
  }

  return { odds: results, errors };
}

// ─── Scraper Sportbet ─────────────────────────────────────────────────────────
export async function scrapeSportbet(page, league, homeTeam, awayTeam) {
  const results = {};
  const errors = [];

  try {
    // PASSAGGIO 1: vai su sportbet.it
    console.log(`[Sportbet] Step 1: Navigo su https://www.sportbet.it/`);
    await page.goto('https://www.sportbet.it/', { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Gestione Cookie
    try {
      const cookieBtn = page.locator('#CybotCookiebotDialogBodyButtonDecline, button:has-text("Rifiuta"), button:has-text("Decline")').first();
      if (await cookieBtn.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await cookieBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch { /* ignore */ }

    // PASSAGGIO 2: clicca su SPORT (più o meno in alto a sinistra)
    console.log(`[Sportbet] Step 2: Clicco su SPORT`);
    try {
      const sportLink = page.locator('a.altro-principale:has-text("SPORT"), header a:has-text("SPORT"), .top-menu a:has-text("SPORT")').first();
      if (await sportLink.isVisible({ timeout: 5000 }).catch(()=>false)) {
        await sportLink.click();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);
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
           : `a[href*="/${slug}"], a:has-text("${league}")`;
           
        // Attesa esplicita per permettere al framework frontend (Angular) di popolare i dati
        await page.waitForSelector(locatorStr, { timeout: 8000 }).catch(() => null);

        const potentialLeagues = await page.locator(locatorStr).all();
        console.log(`[Sportbet] Trovati ${potentialLeagues.length} potenziali link per il campionato.`);
        for (const link of potentialLeagues) {
           if (await link.isVisible().catch(()=>false)) {
               try {
                   await link.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(()=>null);
                   await link.click({ timeout: 3000, force: true });
                   await page.waitForLoadState('domcontentloaded');
                   await page.waitForTimeout(3000);
                   clickedLeague = true;
                   console.log(`[Sportbet] ✅ Campionato cliccato con successo!`);
                   break;
               } catch(e) {}
           }
        }
    } catch(e) { console.log(`[Sportbet] Errore iterazione link campionato: ${e.message}`); }

    if (!clickedLeague) {
       console.log(`[Sportbet] ⚠ Nessun click al Campionato andato a buon fine, procedo sperando sia visibile a schermo.`);
    }

    // PASSAGGIO 4: trova la partita da analizzare e clicca la tendina
    console.log(`[Sportbet] Step 4: Cerco la partita "${homeTeam} - ${awayTeam}" e la tendina a comparsa`);
    await page.waitForTimeout(3000); // Extra tempo affinché la pagina del campionato renderizzi tutte le tabelle match
    
    const cHome = homeTeam.substring(0, 5);
    // Prendiamo div o tr (macro-righe) invece delle foglie, perché la tendina è nella riga!
    const potentialRows = await page.locator(`div, tr, li`).filter({ hasText: new RegExp(cHome, 'i') }).all();
    
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

         if (isFastbet && clickedRowLocator) {
             // Estrarre unicamente dall'albero DOM della riga della partita
             return await clickedRowLocator.evaluate(domEvaluateFn);
         } else {
             // Fallback globale pagina
             return await page.evaluate(domEvaluateFn, null);
         }
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

    console.log(`[Sportbet] Quote grezze estratte: ${allMarketData.length}`); fs.writeFileSync("dump_torinov.json", JSON.stringify(allMarketData, null, 2));

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
      if (!results[internalName].sportbet || entry.odds > results[internalName].sportbet) {
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
  let browser = null;
  const allErrors = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
      extraHTTPHeaders: {
        'Accept-Language': 'it-IT,it;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    // Stealth bypass base (aggira protezioni WAF standard es. Akamai)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // ── Sportium ──
    let sportiumOdds = {};
    try {
      const page1 = await context.newPage();
      page1.setDefaultTimeout(WAIT_TIMEOUT);
      const sportiumResult = await scrapeSportium(page1, league, homeTeam, awayTeam);
      sportiumOdds = sportiumResult.odds;
      allErrors.push(...sportiumResult.errors);
      await page1.close();
    } catch (e) {
      allErrors.push(`Sportium: errore imprevisto — ${e.message}`);
    }

    // ── Sportbet ──
    let sportbetOdds = {};
    try {
      const page2 = await context.newPage();
      page2.setDefaultTimeout(WAIT_TIMEOUT);
      const sportbetResult = await scrapeSportbet(page2, league, homeTeam, awayTeam);
      sportbetOdds = sportbetResult.odds;
      allErrors.push(...sportbetResult.errors);
      await page2.close();
    } catch (e) {
      allErrors.push(`Sportbet: errore imprevisto — ${e.message}`);
    }

    await context.close();

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
    return { success: false, odds: {}, valueBets: [], errors: allErrors, scrapedAt: new Date().toISOString() };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
