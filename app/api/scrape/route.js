/**
 * app/api/scrape/route.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoint POST: avvia lo scraping di Sportium e Sportbet per una data partita.
 *
 * Body atteso:
 * {
 *   league:   string,   // es. "SerieA"
 *   homeTeam: string,   // es. "Inter"
 *   awayTeam: string,   // es. "Juventus"
 *   markets:  Array     // [{ name, probability, isDiscarded, ... }] dal motore
 * }
 *
 * Risposta:
 * {
 *   success:    boolean,
 *   odds:       Object,   // { "OVER 2,5 GOL": { sportium: 1.85, sportbet: 1.90 } }
 *   valueBets:  Array,    // [{ marketName, bookmaker, odds, probability, edge }]
 *   stats:      Object,   // statistiche scraping
 *   errors:     Array,    // errori non critici (sito non raggiungibile, ecc.)
 *   scrapedAt:  string,
 * }
 *
 * NOTA: questo endpoint può impiegare 30-60 secondi.
 * NON far crashare il server: tutti gli errori vengono catturati e restituiti
 * nel campo "errors" con success: false se critico.
 */

import { NextResponse } from 'next/server';
import { scrapeBothBooks } from '@/lib/scraper';
import { getDb, getSetting } from '@/lib/db';

// Next.js App Router: indica il timeout massimo della route (in secondi).
export const maxDuration = 90;

// Forza l'esecuzione in Node.js runtime (Playwright non funziona sull'Edge runtime)
export const runtime = 'nodejs';

/**
 * Proxy verso il servizio scraper locale (esposto via ngrok).
 * Usato quando SCRAPER_SERVICE_URL è impostato (cioè in produzione su Vercel).
 */
async function proxyToScraperService(scraperUrl, body) {
  const url = `${scraperUrl.replace(/\/$/, '')}/scrape`;
  console.log(`[/api/scrape] Proxy → ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 85_000); // 85s max

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header ngrok per saltare la pagina di avviso browser (obbligatorio per fetch non-browser)
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => 'nessun body');
      throw new Error(`Scraper service ha risposto ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

export async function POST(request) {
  let body;

  // ── Parsing del body ──────────────────────────────────────────────────────
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body JSON non valido' },
      { status: 400 }
    );
  }

  const { league, homeTeam, awayTeam, markets = [] } = body;

  if (!league || !homeTeam || !awayTeam) {
    return NextResponse.json(
      { success: false, error: 'Campi obbligatori mancanti: league, homeTeam, awayTeam' },
      { status: 400 }
    );
  }

  // ── Modalità: proxy verso scraper locale (Vercel) o Playwright diretto (locale) ──
  const scraperServiceUrl = process.env.SCRAPER_SERVICE_URL;

  if (scraperServiceUrl) {
    // ── MODALITÀ PRODUZIONE: delega al servizio locale via ngrok ─────────────
    console.log('[/api/scrape] Modalità proxy → scraper service locale');
    try {
      const result = await proxyToScraperService(scraperServiceUrl, body);
      return NextResponse.json(result);
    } catch (e) {
      console.error('[/api/scrape] Errore proxy scraper service:', e);

      // Controlla se il servizio locale non è avviato
      const isConnectionError = e.message?.includes('fetch') || e.name === 'AbortError';
      const hint = isConnectionError
        ? ' — Assicurati che scraper-service/start.bat sia in esecuzione sul tuo PC!'
        : '';

      return NextResponse.json(
        {
          success: false,
          error: `Scraper service non raggiungibile: ${e.message}${hint}`,
          odds: {},
          valueBets: [],
          errors: [e.message],
          scrapedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
  }

  // ── MODALITÀ LOCALE: Playwright diretto (comportamento originale) ──────────
  console.log('[/api/scrape] Modalità locale → Playwright diretto');

  // Leggi minEdge dal DB
  let minEdge = 0.20;
  try {
    const settingVal = await getSetting('min_edge');
    if (settingVal) minEdge = parseFloat(settingVal);
  } catch {
    // Fallback al valore di default
  }

  // Lancia lo scraper
  let scrapeResult;
  try {
    scrapeResult = await scrapeBothBooks(league, homeTeam, awayTeam, markets, minEdge);
  } catch (e) {
    console.error('[/api/scrape] Errore critico:', e);
    return NextResponse.json(
      {
        success: false,
        error:   `Errore critico scraper: ${e.message}`,
        odds:    {},
        valueBets: [],
        errors:  [e.message],
        scrapedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }

  // ── Salva quote nel DB (match_odds) ───────────────────────────────────────
  // Anche se lo scraper ha trovato poche quote, tentiamo di salvarle in DB
  // in modo che siano visibili nella UI senza bisogno di reinserimento manuale.
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
        console.log(`[API] Salvate ${stmts.length} quote nel DB con successo.`);
      }
    } catch (dbErr) {
      console.error('[/api/scrape] Errore salvataggio DB:', dbErr);
      scrapeResult.errors.push(`Salvataggio DB non riuscito: ${dbErr.message}`);
    }
  }

  console.log(`[API] Scrape completato con successo. Invio risposta al frontend. (Odds: ${Object.keys(scrapeResult.odds).length})`);

  // ── Risposta finale ───────────────────────────────────────────────────────
  return NextResponse.json({
    success:    scrapeResult.success,
    odds:       scrapeResult.odds,
    valueBets:  scrapeResult.valueBets,
    stats: {
      ...scrapeResult.stats,
      savedToDB: savedCount,
    },
    errors:    scrapeResult.errors,
    scrapedAt: scrapeResult.scrapedAt,
  });
}
