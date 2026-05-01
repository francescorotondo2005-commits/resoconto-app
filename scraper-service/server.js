/**
 * scraper-service/server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Servizio Express standalone che esegue lo scraping Playwright in locale.
 * Viene chiamato da Vercel (Next.js) tramite tunnel ngrok.
 *
 * Endpoint:
 *   POST /scrape   - Avvia scraping per una partita
 *   GET  /health   - Verifica che il servizio sia attivo
 *
 * Avvio: node server.js  (o tramite start.bat)
 * Porta: 3001 (configurabile via env PORT)
 */

import 'dotenv/config';
import express from 'express';

// Importa il modulo scraper e il db dalla cartella lib del progetto principale
import { scrapeBothBooks } from '../lib/scraper.js';
import { getDb, getSetting } from '../lib/db.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '5mb' }));

// CORS: consenti chiamate da Vercel e da localhost
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Logging base di ogni richiesta
app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Risponde con lo stato del servizio. Utile per verificare che ngrok funzioni.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'scraper-service',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /scrape
 * Body: { league, homeTeam, awayTeam, markets }
 * Risposta: identica all'API /api/scrape di Next.js
 */
app.post('/scrape', async (req, res) => {
  const { league, homeTeam, awayTeam, markets = [] } = req.body || {};

  if (!league || !homeTeam || !awayTeam) {
    return res.status(400).json({
      success: false,
      error: 'Campi obbligatori mancanti: league, homeTeam, awayTeam',
    });
  }

  console.log(`\n[Scraper] ── Avvio scraping: ${homeTeam} vs ${awayTeam} (${league}) ──`);

  // Leggi minEdge dal DB (Turso)
  let minEdge = 0.20;
  try {
    const settingVal = await getSetting('min_edge');
    if (settingVal) minEdge = parseFloat(settingVal);
  } catch {
    // Fallback al default
  }

  // ── Lancia lo scraper ──────────────────────────────────────────────────────
  let scrapeResult;
  try {
    scrapeResult = await scrapeBothBooks(league, homeTeam, awayTeam, markets, minEdge);
  } catch (e) {
    console.error('[Scraper] Errore critico:', e);
    return res.status(500).json({
      success: false,
      error: `Errore critico scraper: ${e.message}`,
      odds: {},
      valueBets: [],
      errors: [e.message],
      scrapedAt: new Date().toISOString(),
    });
  }

  // ── Salva quote nel DB (Turso) ─────────────────────────────────────────────
  const matchKey = `${league}|${homeTeam}|${awayTeam}`;
  let savedCount = 0;

  if (scrapeResult.success && Object.keys(scrapeResult.odds).length > 0) {
    try {
      const db = await getDb();
      const stmts = [];

      for (const [marketName, bookOdds] of Object.entries(scrapeResult.odds)) {
        const sportium = bookOdds.sportium || null;
        const sportbet = bookOdds.sportbet || null;
        if (!sportium && !sportbet) continue;

        stmts.push({
          sql: `INSERT INTO match_odds (match_key, market_name, sportium, sportbet, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(match_key, market_name) DO UPDATE SET
                  sportium   = COALESCE(excluded.sportium, sportium),
                  sportbet   = COALESCE(excluded.sportbet, sportbet),
                  updated_at = CURRENT_TIMESTAMP`,
          args: [matchKey, marketName, sportium, sportbet],
        });
        savedCount++;
      }

      if (stmts.length > 0) {
        await db.batch(stmts);
        console.log(`[Scraper] ✅ Salvate ${stmts.length} quote su Turso.`);
      }
    } catch (dbErr) {
      console.error('[Scraper] Errore salvataggio Turso:', dbErr);
      scrapeResult.errors.push(`Salvataggio DB non riuscito: ${dbErr.message}`);
    }
  }

  console.log(`[Scraper] ── Fine scraping. Odds trovate: ${Object.keys(scrapeResult.odds).length} ──\n`);

  return res.json({
    success: scrapeResult.success,
    odds: scrapeResult.odds,
    valueBets: scrapeResult.valueBets,
    stats: {
      ...scrapeResult.stats,
      savedToDB: savedCount,
    },
    errors: scrapeResult.errors,
    scrapedAt: scrapeResult.scrapedAt,
  });
});

// ── Avvio server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          SCRAPER SERVICE — Avviato con successo      ║');
  console.log(`║  Porta locale : http://localhost:${PORT}              ║`);
  console.log(`║  ngrok tunnel : https://radiotoxic-bobbye-sharklike.ngrok-free.dev ║`);
  console.log('║                                                      ║');
  console.log('║  Endpoint disponibili:                               ║');
  console.log('║    GET  /health  — verifica stato                    ║');
  console.log('║    POST /scrape  — avvia scraping partita            ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('In attesa di richieste da Vercel...');
  console.log('(Premi Ctrl+C per fermare il servizio)');
  console.log('');
});
