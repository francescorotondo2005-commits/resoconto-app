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
  const [minBacktestEdge, setMinBacktestEdge] = useState(0.15); // Default 15%
  const [minBacktestProb, setMinBacktestProb] = useState(0.65); // Default 65%

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
    try {
      const res = await fetch(`/api/backtest`);
      const data = await res.json();
      setBacktestBets(data.backtestBets || []);
      setBacktestStats(data.stats || {});
    } catch (e) { console.error(e); }
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

  const filteredBacktestBets = backtestBets.filter(b => b.best_edge >= minBacktestEdge && b.probability >= minBacktestProb);
  
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, flex: 1 }}>
                  <strong>Cosa vedo qui?</strong> Il sistema registra *ogni scommessa* calcolata in Analisi prima che sia refertata.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '6px 16px', borderRadius: 'var(--radius-lg)' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Edge Minimo:</label>
                    <input type="number" step="1" min="0" max="100" className="input-field" style={{ width: 60, padding: '4px 8px', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }} value={Math.round(minBacktestEdge * 100)} onChange={e => setMinBacktestEdge(parseFloat(e.target.value) / 100 || 0)} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '6px 16px', borderRadius: 'var(--radius-lg)' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Prob Minima:</label>
                    <input type="number" step="1" min="0" max="100" className="input-field" style={{ width: 60, padding: '4px 8px', textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }} value={Math.round(minBacktestProb * 100)} onChange={e => setMinBacktestProb(parseFloat(e.target.value) / 100 || 0)} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>%</span>
                  </div>
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

            <div className="table-container" style={{ maxHeight: '60vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Data Match</th><th>Chiave Match</th><th>Scommessa</th><th>Cat.</th>
                    <th>Prob.</th><th>Sportium</th><th>Sportbet</th><th>Edge MAX</th>
                    <th>Esito Reale</th><th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBacktestBets.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontSize: 12 }}>{b.match_date}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{b.match_key.replace(/\|/g, ' - ')}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{b.bet_name}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.bet_category}</td>
                      <td>{(b.probability * 100).toFixed(1)}%</td>
                      <td>{b.sportium || '—'}</td>
                      <td>{b.sportbet || '—'}</td>
                      <td className={`edge-indicator ${b.best_edge >= 0 ? 'positive' : 'negative'}`}>
                        {(b.best_edge * 100).toFixed(1)}%
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
                  ))}
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

        {toast && <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>{toast.message}</div>}
      </main>
    </div>
  );
}
