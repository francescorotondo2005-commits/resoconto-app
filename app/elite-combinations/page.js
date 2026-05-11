'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

export default function EliteCombinationsPage() {
  const [minWinRate, setMinWinRate] = useState(80);
  const [minBets, setMinBets]       = useState(14);
  const [minQuota, setMinQuota]     = useState(1.60);
  const [topK, setTopK]             = useState(5000);

  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [elapsed, setElapsed]   = useState(null);

  const [scraperUrl, setScraperUrl] = useState('');
  const [combinations, setCombinations] = useState([]);
  const [lastGenerated, setLastGenerated] = useState(null);
  const [loadingFile, setLoadingFile] = useState(true);

  // Carica l'URL ngrok dalle impostazioni (lo stesso del servizio scraper)
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setScraperUrl(data.scraper_url || ''))
      .catch(() => {});
  }, []);

  // Carica il file JSON esistente all'avvio
  useEffect(() => {
    fetch('/topCombinations.json?t=' + Date.now())
      .then(r => r.json())
      .then(data => {
        setCombinations(data.combinations || []);
        setLastGenerated(data.generatedAt || null);
      })
      .catch(() => setCombinations([]))
      .finally(() => setLoadingFile(false));
  }, [result]); // ricarica dopo ogni calcolo

  async function runGridSearch() {
    setRunning(true);
    setError(null);
    setResult(null);
    const t0 = Date.now();

    const payload = JSON.stringify({ minWinRate: minWinRate / 100, minBets, minQuota, topK });
    const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' };
    const timeout = AbortSignal.timeout(600_000);

    // Costruisce la lista di URL da provare: prima ngrok (se configurato), poi localhost
    const candidates = [];
    if (scraperUrl) candidates.push(scraperUrl.replace(/\/$/, '') + '/combo');
    candidates.push('http://localhost:3001/combo');

    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: payload, signal: timeout });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Errore dal servizio locale');
        setResult(data);
        setElapsed(((Date.now() - t0) / 1000).toFixed(1));
        setRunning(false);
        return;
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
          setError('Timeout: il calcolo ha impiegato troppo. Riprova.');
          setRunning(false);
          return;
        }
        // Questo URL non funziona, prova il prossimo
        continue;
      }
    }

    // Nessun URL ha risposto
    setError('⚠️ Servizio locale non raggiungibile. Assicurati che start.bat sia attivo nella cartella scraper-service.');
    setRunning(false);
  }

  const pct  = v => `${(v * 100).toFixed(1)}%`;
  const pct0 = v => `${(v * 100).toFixed(0)}%`;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">🏆 Combinazioni Elite</h1>
            <p className="page-subtitle">
              Genera e consulta le migliori combinazioni di parametri filtrate dal backtest.
            </p>
          </div>
        </div>


        {lastGenerated && (
          <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent-primary)' }}>●</span> 
            Ultimo ricalcolo locale effettuato il: <strong>{new Date(lastGenerated).toLocaleString('it-IT')}</strong>
          </div>
        )}

        {/* Tabella Combinazioni */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            📊 Classifica Combinazioni ({loadingFile ? '...' : combinations.length})
          </div>

          {loadingFile ? (
            <div className="loading-container"><span className="loading-spinner" /> Caricamento...</div>
          ) : combinations.length === 0 ? (
            <div className="empty-state">
              <p>Nessuna combinazione trovata. Esegui prima il calcolo.</p>
            </div>
          ) : (
            <div className="table-container" style={{ maxHeight: '65vh', overflow: 'auto' }}>
              <table style={{ fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                  <tr>
                    <th>#</th>
                    <th>Win Rate</th>
                    <th>Yield</th>
                    <th>Scommesse</th>
                    <th>Profitto</th>
                    <th>Edge Min</th>
                    <th>Prob Min</th>
                    <th>Media Stor.</th>
                    <th>Singolo Stor.</th>
                    <th>Media Forma</th>
                    <th>Singolo Forma</th>
                  </tr>
                </thead>
                <tbody>
                  {combinations.map((c, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                      <td style={{ fontWeight: 800, color: c.winRate >= 0.90 ? 'var(--green)' : c.winRate >= 0.85 ? 'var(--accent-secondary)' : 'var(--text-primary)' }}>
                        {pct(c.winRate)}
                      </td>
                      <td style={{ color: c.yieldPct > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {pct(c.yieldPct)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{c.total}</td>
                      <td style={{ color: c.profit > 0 ? 'var(--green)' : 'var(--red)' }}>
                        €{c.profit.toFixed(2)}
                      </td>
                      <td>{pct0(c.params.minEdge)}</td>
                      <td>{pct0(c.params.minProb)}</td>
                      <td>{pct0(c.params.minHistAvg)}</td>
                      <td>{pct0(c.params.minHistSingle)}</td>
                      <td>{pct0(c.params.minFormAvg)}</td>
                      <td>{pct0(c.params.minFormSingle)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
