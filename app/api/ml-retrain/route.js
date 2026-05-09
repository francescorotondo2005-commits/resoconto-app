import { NextResponse } from 'next/server';

/**
 * POST /api/ml-retrain
 * Proxy verso il scraper-service locale (via ngrok) per avviare il re-training dei modelli ML.
 * Il scraper-service esegue ml_train_all.py in background e risponde subito.
 */
export async function POST() {
  const scraperUrl = process.env.SCRAPER_SERVICE_URL;

  if (!scraperUrl) {
    return NextResponse.json({
      success: false,
      message: 'Servizio ML non configurato. Imposta SCRAPER_SERVICE_URL in .env.local e avvia il scraper-service.',
    }, { status: 503 });
  }

  try {
    const res = await fetch(`${scraperUrl}/retrain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, message: `Errore scraper-service: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    console.warn('[ML Retrain] Servizio non raggiungibile:', e.message);
    return NextResponse.json({
      success: false,
      message: 'Scraper-service non raggiungibile. Assicurati che sia avviato e che ngrok sia attivo.',
    }, { status: 503 });
  }
}

/**
 * GET /api/ml-retrain
 * Controlla se il re-training è in corso.
 */
export async function GET() {
  const scraperUrl = process.env.SCRAPER_SERVICE_URL;
  if (!scraperUrl) return NextResponse.json({ running: false, configured: false });

  try {
    const res = await fetch(`${scraperUrl}/retrain/status`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NextResponse.json({ running: false, configured: true });
    const data = await res.json();
    return NextResponse.json({ ...data, configured: true });
  } catch {
    return NextResponse.json({ running: false, configured: true, reachable: false });
  }
}
