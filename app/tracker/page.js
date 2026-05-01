'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

export default function TrackerPage() {
  const [activeTab, setActiveTab] = useState('mine'); // 'mine' or 'backtest'
  
  // Bets (Mine)
  const [bets, setBets] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  
  // Backtest
  const [backtestBets, setBacktestBets] = useState([]);
  const [backtestStats, setBacktestStats] = useState({});
  const [minBacktestEdge, setMinBacktestEdge] = useState(0.15);
  const [minBacktestProb, setMinBacktestProb] = useState(0.65);
  const [minBacktestHist, setMinBacktestHist] = useState(0);   // 0 = nessun filtro
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  // Popup storico/forma backtest
  const [histPopup, setHistPopup] = useState(null);

  const [toast, setToast] = useState(null);
  
  // Edit Bet Modal
  const [editModal, setEditModal] = useState(null);


  useEffect(() => { 
    loadBets(); 
    loadBacktest();
  }, []);

  async function loadBets() {
    setLoading(true);
    try {
      const res = await fetch(`/api/bets`);
      const data = await res.json();
      setBets(data.bets || []);
      setStats(data.stats || {});
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function loadBacktest() {
    setBacktestLoading(true);
    try {
      const res = await fetch(`/api/backtest`);
      const data = await res.json();
      setBacktestBets(data.backtestBets || []);
      setBacktestStats(data.stats || {});
    } catch (e) { console.error(e); }
    setBacktestLoading(false);
  }

  async function runBackfill() {
    if (!confirm('Calcola lo storico per tutte le scommesse del backtest senza dato? Potrebbe richiedere qualche secondo.')) return;
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backfill' }),
      });
      const data = await res.json();
      setBackfillResult(data);
      if (data.success) {
        setToast({ type: 'success', message: `✅ Storico calcolato per ${data.updated} scommesse!` });
        loadBacktest(); // Ricarica con i nuovi dati
      } else {
        setToast({ type: 'error', message: data.error || 'Errore backfill' });
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
    setBackfillLoading(false);
  }

  async function deleteBet(id) {
    if (!confirm('Sei sicuro di voler eliminare questa scommessa definitivamente?')) return;
    try {
      await fetch('/api/bets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setToast({ type: 'success', message: 'Scommessa eliminata.' });
      loadBets();
      setTimeout(() => setToast(null), 3000);
    } catch (e) { console.error(e); }
  }

  async function updateBetOdds() {
    if (!editModal || !editModal.newOdds) return;
    try {
      const edge = (editModal.bet.probability * editModal.newOdds) - 1;
      
      let newProfit = editModal.bet.profit;
      if (editModal.bet.outcome === 'WIN') {
        newProfit = editModal.bet.stake * editModal.newOdds - editModal.bet.stake;
      }

      const res = await fetch('/api/bets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_odds',
          id: editModal.bet.id,
          actual_odds: editModal.newOdds,
          bookmaker: editModal.newBookmaker,
          edge,
          profit: newProfit
        }),
      });

      if (res.ok) {
        setToast({ type: 'success', message: 'Quota scommessa aggiornata con successo!' });
        setEditModal(null);
        loadBets();
      }
    } catch (error) {
      setToast({ type: 'error', message: error.message });
    }
  }

  async function deleteBacktestBet(id) {
    if (!confirm('Sei sicuro di voler eliminare questa scommessa di backtest?')) return;
    try {
      await fetch('/api/backtest', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setToast({ type: 'success', message: 'Backtest eliminato.' });
      loadBacktest();
      setTimeout(() => setToast(null), 3000);
    } catch (e) { console.error(e); }
  }

  // Visuals for bankrolls
  const bankrollHistory = [];
  let runningTotal = 0;
  const sortedBets = [...(bets.filter(b => b.outcome !== 'PENDING' && b.outcome !== 'VOID'))].sort((a, b) => 
    new Date(a.created_at) - new Date(b.created_at)
  );
  for (const b of sortedBets) {
    runningTotal += b.profit || 0;
    bankrollHistory.push(runningTotal);
  }

  const filteredBacktestBets = backtestBets.filter(b => {
    if (b.best_edge < minBacktestEdge) return false;
    if (b.probability < minBacktestProb) return false;
    if (minBacktestHist > 0 && (b.hist_score === null || b.hist_score === undefined || b.hist_score < minBacktestHist)) return false;
    return true;
  });
  
  const backtestHistory = [];
  let btTotal = 0;
  let btWins = 0;
  let btFinished = 0;
  
  const sortedBT = [...(filteredBacktestBets.filter(b => b.outcome !== 'PENDING' && b.outcome !== 'VOID'))].sort((a, b) => 
    new Date(a.created_at) - new Date(b.created_at)
  );
  
  for (const b of sortedBT) {
    btFinished++;
    if (b.outcome === 'WIN') btWins++;
    btTotal += b.outcome === 'WIN' ? (Math.max(b.sportium || 1, b.sportbet || 1) - 1) : -1;
    backtestHistory.push(btTotal);
  }

  const filteredHitRate = btFinished > 0 ? btWins / btFinished : 0;
  const filteredYield = btFinished > 0 ? (btTotal / btFinished) : 0;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header" style={{ marginBottom: 20 }}>
          <h1 className="page-title">📈 Tracker & Backtest</h1>
          <p className="page-subtitle">Monitora le tue giocate e le performance del modello</p>
        </div>

        {/* Tabs */}
        <div className="filter-bar" style={{ marginBottom: 32 }}>
          <div className="toggle-group" style={{ width: '100%', display: 'flex' }}>
            <button 
              className={`toggle-btn ${activeTab === 'mine' ? 'active' : ''}`} 
              onClick={() => setActiveTab('mine')}
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
            >
              💼 Le Mie Scommesse
            </button>
            <button 
              className={`toggle-btn ${activeTab === 'backtest' ? 'active' : ''}`} 
              onClick={() => setActiveTab('backtest')}
              style={{ flex: 1, padding: '12px', fontSize: 14 }}
            >
              🤖 Backtesting Globale
            </button>
          </div>
        </div>

        {activeTab === 'mine' && (
          <>
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Totale Bet</div>
                <div className="stat-value">{stats.total || 0}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Hit Rate</div>
                <div className={`stat-value ${(stats.hitRate || 0) >= 0.5 ? 'positive' : ''}`}>
                  {stats.hitRate ? `${(stats.hitRate * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">P&L Netto</div>
                <div className={`stat-value ${(stats.totalProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
                  €{(stats.totalProfit || 0).toFixed(2)}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Yield Stimato</div>
                <div className={`stat-value ${(stats.totalProfit || 0) > 0 ? 'positive' : ''}`}>
                  {stats.totalStaked ? `${((stats.totalProfit / stats.totalStaked) * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>

            {/* Bankroll Chart */}
            {bankrollHistory.length > 1 && (
              <div className="card" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📊 Andamento P&L (Le Mie Bet)</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, padding: '0 8px' }}>
                  {bankrollHistory.map((val, i) => {
                    const max = Math.max(...bankrollHistory.map(Math.abs), 1);
                    const height = Math.abs(val) / max * 100;
                    return (
                      <div key={i} style={{
                        flex: 1,
                        maxWidth: 12,
                        height: `${Math.max(height, 4)}%`,
                        background: val >= 0 ? 'var(--green)' : 'var(--red)',
                        borderRadius: '2px 2px 0 0',
                        opacity: 0.8,
                        alignSelf: val >= 0 ? 'flex-end' : 'flex-start',
                        transition: 'height 0.3s ease',
                      }} title={`€${val.toFixed(2)}`} />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="table-container" style={{ maxHeight: '60vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Data Inserimento</th><th>Partita</th><th>Scommessa</th><th>Cat.</th>
                    <th>Prob.</th><th>Quota</th><th>Edge</th><th>Book</th>
                    <th>Stake</th><th>Esito</th><th>P&L</th><th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontSize: 12 }}>{new Date(b.created_at).toLocaleDateString()}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{b.match_description}</td>
                      <td style={{ fontSize: 12 }}>{b.bet_name}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.bet_category}</td>
                      <td>{(b.probability * 100).toFixed(1)}%</td>
                      <td style={{ fontWeight: 600 }}>{b.actual_odds?.toFixed(2)}</td>
                      <td className={`edge-indicator ${b.edge >= 0 ? 'positive' : 'negative'}`}>
                        {(b.edge * 100).toFixed(1)}%
                      </td>
                      <td style={{ fontSize: 12 }}>{b.bookmaker}</td>
                      <td>€{b.stake?.toFixed(2)}</td>
                      <td>
                        {b.outcome === 'PENDING' ? (
                          <span className="badge badge-pending">ATTESA</span>
                        ) : b.outcome === 'WIN' ? (
                          <span className="badge badge-win">WIN</span>
                        ) : b.outcome === 'VOID' ? (
                          <span className="badge badge-warning">VOID</span>
                        ) : (
                          <span className="badge badge-loss">LOSS</span>
                        )}
                      </td>
                      <td style={{ fontWeight: 600, color: (b.profit || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {b.profit != null ? `€${b.profit.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', color: 'var(--blue)' }} onClick={() => setEditModal({ bet: b, newOdds: b.actual_odds, newBookmaker: b.bookmaker })} title="Modifica Scommessa">
                          ✏️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                * Le scommesse in "ATTESA" (Pending) verranno refertate automaticamente all'inserimento del risultato nel Database.
              </div>
            </div>
          </>
        )}

        {/* ================= BACKTEST TAB ================= */}
        {activeTab === 'backtest' && (
          <>
            <div className="card" style={{ marginBottom: 20, background: 'rgba(108, 92, 231, 0.05)', borderColor: 'rgba(108, 92, 231, 0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, flex: 1, minWidth: 200 }}>
                  <strong>Cosa vedo qui?</strong> Il sistema registra ogni scommessa calcolata in Analisi prima che sia refertata.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '6px 16px', borderRadius: 'var(--radius-lg)' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Edge Min:</label>
                    <input type="number" step="1" min="0" max="100" className="input-field" style={{ width: 55, padding: '4px 8px', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }} value={Math.round(minBacktestEdge * 100)} onChange={e => setMinBacktestEdge(parseFloat(e.target.value) / 100 || 0)} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '6px 16px', borderRadius: 'var(--radius-lg)' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Prob Min:</label>
                    <input type="number" step="1" min="0" max="100" className="input-field" style={{ width: 55, padding: '4px 8px', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }} value={Math.round(minBacktestProb * 100)} onChange={e => setMinBacktestProb(parseFloat(e.target.value) / 100 || 0)} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.08)', padding: '6px 16px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase' }}>Hist% Min:</label>
                    <input type="number" step="1" min="0" max="100" className="input-field" style={{ width: 55, padding: '4px 8px', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }} value={Math.round(minBacktestHist * 100)} onChange={e => setMinBacktestHist(parseFloat(e.target.value) / 100 || 0)} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>%</span>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={runBackfill}
                    disabled={backfillLoading}
                    title="Calcola lo storico per le scommesse che non ce l'hanno ancora"
                    style={{ fontSize: 11, opacity: backfillLoading ? 0.6 : 1 }}
                  >
                    {backfillLoading ? '⏳ Calcolo...' : '🔄 Calcola Storico'}
                  </button>
                </div>
              </div>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Value Bet Evaluate ({Math.round(minBacktestEdge*100)}%+)</div>
                <div className="stat-value">{filteredBacktestBets.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Hit Rate Modello</div>
                <div className={`stat-value ${filteredHitRate >= 0.5 ? 'positive' : ''}`}>
                  {btFinished > 0 ? `${(filteredHitRate * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">P&L Teorico (@1€ unit)</div>
                <div className={`stat-value ${btTotal >= 0 ? 'positive' : 'negative'}`}>
                  {btTotal >= 0 ? '+' : ''}{btTotal.toFixed(2)} U
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Yield Netto</div>
                <div className={`stat-value ${filteredYield > 0 ? 'positive' : 'negative'}`}>
                  {btFinished > 0 ? `${(filteredYield * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>

            {/* Backtest Chart */}
            {backtestHistory.length > 1 && (
              <div className="card" style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📊 Curva di Valore (Modello Integrale)</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, padding: '0 8px' }}>
                  {backtestHistory.map((val, i) => {
                    const max = Math.max(...backtestHistory.map(Math.abs), 1);
                    const height = Math.abs(val) / max * 100;
                    return (
                      <div key={i} style={{
                        flex: 1,
                        maxWidth: 6,
                        height: `${Math.max(height, 4)}%`,
                        background: val >= 0 ? 'var(--blue)' : 'var(--red)',
                        borderRadius: '2px 2px 0 0',
                        opacity: 0.8,
                        alignSelf: val >= 0 ? 'flex-end' : 'flex-start',
                        transition: 'height 0.3s ease',
                      }} title={`${val.toFixed(2)} U`} />
                    );
                  })}
                </div>
              </div>
            )}

            {backtestLoading && (
              <div className="loading-container" style={{ padding: 32 }}>
                <span className="loading-spinner" /> Calcolo storico in corso...
              </div>
            )}

            <div className="table-container" style={{ maxHeight: '60vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Data Match</th><th>Partita</th><th>Scommessa</th><th>Cat.</th>
                    <th>Prob.</th><th>Sportium</th><th>Sportbet</th><th>Edge MAX</th>
                    <th style={{ color: 'var(--green)' }}>Hist%</th>
                    <th>Esito</th><th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBacktestBets.map(b => {
                    const [, homeTeam, awayTeam] = b.match_key.split('|');
                    const histScore = b.hist_score;
                    const histColor = histScore === null || histScore === undefined ? 'var(--text-muted)'
                      : histScore >= 0.65 ? 'var(--green)'
                      : histScore >= 0.50 ? 'var(--accent-secondary)'
                      : 'var(--red)';
                    return (
                    <tr key={b.id}>
                      <td style={{ fontSize: 12 }}>{b.match_date}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{homeTeam} - {awayTeam}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{b.bet_name}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.bet_category}</td>
                      <td>{(b.probability * 100).toFixed(1)}%</td>
                      <td>{b.sportium || '—'}</td>
                      <td>{b.sportbet || '—'}</td>
                      <td className={`edge-indicator ${b.best_edge >= 0 ? 'positive' : 'negative'}`}>
                        {(b.best_edge * 100).toFixed(1)}%
                      </td>
                      <td>
                        {histScore !== null && histScore !== undefined ? (
                          <button
                            onClick={() => setHistPopup(b)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              fontWeight: 700, fontSize: 13, color: histColor,
                              padding: '2px 6px', borderRadius: 4,
                              outline: '1px solid currentColor',
                            }}
                            title="Clicca per dettaglio storico e forma"
                          >
                            {Math.round(histScore * 100)}%
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {b.outcome === 'WIN' ? (
                          <span className="badge badge-win">WIN</span>
                        ) : b.outcome === 'VOID' ? (
                          <span className="badge badge-warning">VOID</span>
                        ) : b.outcome === 'LOSS' ? (
                          <span className="badge badge-loss">LOSS</span>
                        ) : (
                          <span className="badge badge-pending">PENDING</span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px', color: 'var(--red)' }} onClick={() => deleteBacktestBet(b.id)} title="Elimina Backtest">
                          🗑️
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Modal Modifica Quota */}
        {editModal && (
          <div className="modal-overlay" onClick={() => setEditModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
              <h2 className="modal-title">✏️ Modifica Quota Scommessa</h2>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{editModal.bet.match_description}</div>
                <div style={{ fontSize: 16, fontWeight: 700, margin: '4px 0' }}>{editModal.bet.bet_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Probabilità originaria: {(editModal.bet.probability * 100).toFixed(1)}%</div>
              </div>
              
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="input-group">
                  <label>Aggiorna Quota</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="1.01" 
                    value={editModal.newOdds} 
                    onChange={e => setEditModal({ ...editModal, newOdds: parseFloat(e.target.value) || '' })} 
                    autoFocus
                  />
                </div>
                <div className="input-group">
                  <label>Bookmaker</label>
                  <input 
                    type="text" 
                    value={editModal.newBookmaker} 
                    onChange={e => setEditModal({ ...editModal, newBookmaker: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 16, fontSize: 14 }}>
                <span style={{ color: 'var(--text-muted)' }}>Nuovo Edge Calcolato: </span>
                <strong className={(editModal.newOdds && (editModal.bet.probability * editModal.newOdds) - 1 > 0) ? 'positive' : 'negative'}>
                  {editModal.newOdds ? (((editModal.bet.probability * editModal.newOdds) - 1) * 100).toFixed(1) : 0}%
                </strong>
              </div>

              <div className="form-actions" style={{ marginTop: 24, justifyContent: 'space-between' }}>
                <button 
                   className="btn btn-secondary" 
                   style={{ color: 'var(--red)', padding: '8px 12px', background: 'transparent' }} 
                   onClick={() => {
                     deleteBet(editModal.bet.id);
                     setEditModal(null);
                   }}
                >
                   🗑️ Elimina Definitivamente
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Annulla</button>
                  <button className="btn btn-primary" onClick={updateBetOdds}>Salva Quota</button>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Modal Storico + Forma Backtest */}
        {histPopup && (() => {
          const b = histPopup;
          const [, homeTeam, awayTeam] = b.match_key.split('|');
          const fmtPct = (v) => v !== null && v !== undefined ? `${Math.round(v * 100)}%` : '—';
          const histColor = (v) => v === null || v === undefined ? 'var(--text-muted)'
            : v >= 0.65 ? 'var(--green)' : v >= 0.50 ? 'var(--accent-secondary)' : 'var(--red)';
          return (
            <div className="modal-overlay" onClick={() => setHistPopup(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                    Storico & Forma — Backtest
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{b.bet_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {homeTeam} - {awayTeam} · {b.match_date}
                  </div>
                </div>

                {/* Hist Score globale */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>Punteggio Storico Aggregato</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: histColor(b.hist_score) }}>
                    {fmtPct(b.hist_score)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Esito: <strong style={{ color: b.outcome === 'WIN' ? 'var(--green)' : b.outcome === 'LOSS' ? 'var(--red)' : 'var(--text-muted)' }}>{b.outcome}</strong>
                  </div>
                </div>

                {/* Storico Stagionale */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    📊 Storico Stagionale (alla data della bet)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-card-hover)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {homeTeam} (Casa)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.home_hist_pct) }}>{fmtPct(b.home_hist_pct)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.home_hist_sample ?? 0} partite</div>
                    </div>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-card-hover)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>✈️ {awayTeam} (Trasferta)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.away_hist_pct) }}>{fmtPct(b.away_hist_pct)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.away_hist_sample ?? 0} partite</div>
                    </div>
                    {b.ref_hist_pct !== null && b.ref_hist_pct !== undefined ? (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-card-hover)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🟡 Arbitro</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.ref_hist_pct) }}>{fmtPct(b.ref_hist_pct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.ref_hist_sample ?? 0} partite</div>
                      </div>
                    ) : (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-card-hover)', borderRadius: 8, border: '1px solid var(--border)', opacity: 0.4 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🟡 Arbitro</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>N/A</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stato di Forma (ultime 5) */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    🔥 Stato di Forma (Ultime {b.form_home_n ?? 5} Partite)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {homeTeam}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.form_home_pct) }}>{fmtPct(b.form_home_pct)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ultime {b.form_home_n ?? '—'} in casa</div>
                    </div>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>✈️ {awayTeam}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.form_away_pct) }}>{fmtPct(b.form_away_pct)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ultime {b.form_away_n ?? '—'} in trasferta</div>
                    </div>
                    {b.form_ref_pct !== null && b.form_ref_pct !== undefined ? (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🟡 Arbitro</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: histColor(b.form_ref_pct) }}>{fmtPct(b.form_ref_pct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ultime {b.form_ref_n ?? '—'} dir.</div>
                      </div>
                    ) : (
                      <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)', opacity: 0.4 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🟡 Arbitro</div>
                        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>N/A</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={() => setHistPopup(null)}>Chiudi</button>
                </div>
              </div>
            </div>
          );
        })()}

        {toast && <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>{toast.message}</div>}

      </main>
    </div>
  );
}
