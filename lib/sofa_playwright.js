import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Carica variabili da .env.local se presenti e non già impostate nel processo
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of envLines) {
    if (line.includes('=') && !line.trim().startsWith('#')) {
      const idx = line.indexOf('=');
      const k = line.substring(0, idx).trim();
      const v = line.substring(idx + 1).trim().replace(/^["']|["']$/g, '').replace(/\r/g, '');
      if (k && !process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

/**
 * Esegue una singola richiesta JSON a SofaScore usando Playwright.
 * Comodo per chiamate "one-shot" rapide.
 */
export async function fetchSofaJson(url) {
  const session = await createSofaSession();
  try {
    return await session.fetch(url);
  } finally {
    await session.close();
  }
}

/**
 * Crea una sessione browser persistente per SofaScore.
 * Utile per fare molteplici chiamate consecutive riutilizzando lo stesso browser,
 * risparmiando tempo e risorse rispetto all'avviare/chiudere Chrome ogni volta.
 */
export async function createSofaSession(cfClearance = null, headful = false) {
  const scraperUrl = process.env.SCRAPER_SERVICE_URL;
  if (scraperUrl) {
    console.log(`  [SofaSession] Utilizzo proxy scraper-service su: ${scraperUrl}`);
    return {
      async fetch(url) {
        const proxyUrl = `${scraperUrl.replace(/\/$/, '')}/proxy-sofascore?url=${encodeURIComponent(url)}`;
        try {
          const res = await fetch(proxyUrl, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          if (!res.ok) {
            console.error(`  [SofaSession] ❌ Proxy ha risposto ${res.status}`);
            return { __error: true, status: res.status };
          }
          return await res.json();
        } catch (e) {
          console.error(`  [SofaSession] ❌ Errore Proxy: ${e.message}`);
          return { __error: true, status: 500, message: e.message };
        }
      },
      async close() {
        // Nessun browser da chiudere
      }
    };
  }

  // Avvia il browser in modalità headful o headless usando Chrome reale per massimo stealth
  let browser;
  try {
    browser = await chromium.launch({
      headless: !headful,
      channel: 'chrome'
    });
  } catch (err) {
    // Fallback a Chromium standard se Chrome reale non è disponibile
    browser = await chromium.launch({
      headless: !headful
    });
  }
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  // Inietta gli init script di stealth per non essere rilevato come headless/bot
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  if (cfClearance) {
    // Rimuove l'eventuale prefisso "cf_clearance=" se inserito dall'utente
    const val = cfClearance.replace('cf_clearance=', '').trim();
    await context.addCookies([{
      name: 'cf_clearance',
      value: val,
      domain: '.sofascore.com',
      path: '/'
    }]);
    console.log('  [SofaScore] Cookie cf_clearance iniettato con successo nella sessione.');
  }
  
  const page = await context.newPage();
  
  // Naviga alla homepage di SofaScore per stabilire i cookie e superare il controllo TLS iniziale
  await page.goto('https://www.sofascore.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  return {
    async fetch(url, retryCount = 0) {
      // Sostituisci il sottodominio api.sofascore.com con www.sofascore.com per farlo passare come prima parte
      const webUrl = url.replace('api.sofascore.com', 'www.sofascore.com');
      try {
        // Simula occasionali micro-interazioni umane prima di effettuare il fetch
        if (Math.random() > 0.5) {
          await page.mouse.move(Math.random() * 300, Math.random() * 300);
        }
        
        let res = await page.evaluate(async (targetUrl) => {
          try {
            const response = await fetch(targetUrl);
            if (!response.ok) return { __error: true, status: response.status };
            return await response.json();
          } catch (e) {
            return { __error: true, status: 500, message: e.message };
          }
        }, webUrl);

        // Se otteniamo 403, ricarichiamo la homepage di SofaScore e riproviamo una volta
        if (res && res.__error && res.status === 403 && retryCount < 1) {
          console.log(`  [SofaSession] HTTP 403 rilevato su ${webUrl}. Ricarico la homepage per aggiornare la sessione...`);
          await page.goto('https://www.sofascore.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          return this.fetch(url, retryCount + 1);
        }

        return res;
      } catch (err) {
        console.error(`[SofaSession] ❌ Errore durante la fetch di ${webUrl}:`, err.message);
        return { __error: true, status: 500, message: err.message };
      }
    },
    async close() {
      await browser.close();
    }
  };
}
