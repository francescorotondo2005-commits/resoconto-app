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

  const [combinations, setCombinations] = useState([]);
  const [loadingFile, setLoadingFile]   = useState(true);
  const [lastGenerated, setLastGenerated] = useState(null);

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

    try {
      const res = await fetch('/api/elite-combinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minWinRate: minWinRate / 100,
          minBets,
          minQuota,
          topK,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore sconosciuto');
      setResult(data);
      setElapsed(((Date.now() - t0) / 1000).toFixed(1));
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
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

        {/* Pannello Generazione */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            ⚙️ Parametri Filtro (Maestri)
          </div>

          <div className="form-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div className="input-group">
              <label>Win Rate Minimo (%)</label>
              <input type="number" value={minWinRate} min={50} max={100} step={1}
                onChange={e => setMinWinRate(parseFloat(e.target.value))} />
            </div>
            <div className="input-group">
              <label>Scommesse Minime</label>
              <input type="number" value={minBets} min={1} max={500} step={1}
                onChange={e => setMinBets(parseInt(e.target.value))} />
            </div>
            <div className="input-group">
              <label>Quota Minima</label>
              <input type="number" value={minQuota} min={1.01} max={5} step={0.05}
                onChange={e => setMinQuota(parseFloat(e.target.value))} />
            </div>
            <div className="input-group">
              <label>Max Combinazioni da Salvare</label>
              <input type="number" value={topK} min={100} max={50000} step={100}
                onChange={e => setTopK(parseInt(e.target.value))} />
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              className="btn btn-primary"
              onClick={runGridSearch}
              disabled={running}
              style={{ minWidth: 240 }}
            >
              {running ? '⏳ Calcolo in corso...' : '🚀 Calcola Combinazioni Elite'}
            </button>

            {running && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Questo può richiedere 1-3 minuti. Non chiudere la pagina.
              </div>
            )}

            {result && !running && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 8,
                background: 'rgba(16, 185, 129, 0.12)', border: '1px solid var(--green)',
                fontSize: 13, fontWeight: 600, color: 'var(--green)'
              }}>
                ✅ {result.message} (in {elapsed}s)
              </div>
            )}

            {error && (
              <div style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)',
                fontSize: 13, color: 'var(--red)'
              }}>
                ❌ {error}
              </div>
            )}
          </div>

          {lastGenerated && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              Ultimo aggiornamento: {new Date(lastGenerated).toLocaleString('it-IT')}
            </div>
          )}
        </div>

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
