import { chromium } from 'playwright';

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
export async function createSofaSession() {
  // Avvia il browser in modalità headless
  const browser = await chromium.launch({ headless: true });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  
  const page = await context.newPage();
  
  // Naviga alla homepage di SofaScore per stabilire i cookie e superare il controllo TLS iniziale
  await page.goto('https://www.sofascore.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  return {
    async fetch(url) {
      // Sostituisci il sottodominio api.sofascore.com con www.sofascore.com per farlo passare come prima parte
      const webUrl = url.replace('api.sofascore.com', 'www.sofascore.com');
      try {
        return await page.evaluate(async (targetUrl) => {
          try {
            const res = await fetch(targetUrl);
            if (!res.ok) return { __error: true, status: res.status };
            return await res.json();
          } catch (e) {
            return { __error: true, status: 500, message: e.message };
          }
        }, webUrl);
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
