'use client';

import { useState, useEffect, Suspense } from 'react';
import Sidebar from '@/components/Sidebar';

function ValueBetsContent() {
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  // Modals
  const [betModal, setBetModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  
  // Bet Builder
  const [selectedBets, setSelectedBets] = useState([]);
  
  useEffect(() => {
    fetchValueBets();
  }, []);

  async function fetchValueBets() {
    setLoading(true);
    try {
      const res = await fetch('/api/value-bets');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBets(data.valueBets || []);
    } catch (e) {
      setToast({ type: 'error', message: 'Errore nel caricamento delle quote globali: ' + e.message });
    }
    setLoading(false);
  }

  async function placeBet(bet, stake) {
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          league: bet.league,
          match_description: bet.matchStr,
          bet_name: bet.name,
          bet_category: bet.category,
          ev: bet.ev,
          sd: bet.sd,
          cv: bet.cv,
          probability: bet.probability,
          fair_odds: bet.fairOdds,
          min_odds: bet.minOdds,
          actual_odds: bet.actualOdds,
          bookmaker: bet.bookmaker,
          edge: bet.edge,
          stake,
          stake_kelly: null,
          referee_rating: null,
        }),
      });
      if (res.ok) {
        setToast({ type: 'success', message: `Bet salvata nel Tracker!` });
        setBetModal(null);
        setSelectedBets([]); // Svuota la selezione della multipla
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  // Helpers per Bet Builder
  const toggleBetSelection = (bet, bookmaker) => {
    // Genera una chiave unica includendo il bookmaker scelto
    const key = `${bet.matchKey}-${bet.name}-${bookmaker}`;
    
    if (selectedBets.some(b => b.selectionKey === key)) {
      // Deseleziona se già presente
      setSelectedBets(selectedBets.filter(b => b.selectionKey !== key));
    } else {
      // Vincolo: Stesso Bookmaker
      if (selectedBets.length > 0 && selectedBets[0].bookmaker !== bookmaker) {
        setToast({ type: 'error', message: `Impossibile unire: questa quota è di ${bookmaker}, la tua multipla usa ${selectedBets[0].bookmaker}.` });
        return;
      }
      
      const odds = bookmaker === 'Sportium' ? bet.odds_sportium : bet.odds_sportbet;
      const edge = bookmaker === 'Sportium' ? bet.edge_sportium : bet.edge_sportbet;

      const newSel = {
         ...bet,
         selectionKey: key,
         bookmaker: bookmaker,     // override con la scelta esplicita
         actualOdds: odds,         // override
         edge: edge                // override
      };
      
      setSelectedBets([...selectedBets, newSel]);
    }
  };

  const getMultiplierStats = () => {
    if (selectedBets.length === 0) return null;
    let combinedProb = 1;
    let combinedOdds = 1;
    let combinedEv = 0; // Approssimazione
    let matchStrs = new Set();
    
    selectedBets.forEach(b => {
      combinedProb *= b.probability;
      combinedOdds *= b.actualOdds;
      matchStrs.add(b.matchStr);
    });
    
    const combinedEdge = (combinedProb * combinedOdds) - 1;
    const isSameMatch = matchStrs.size === 1;

    return {
      combinedProb,
      combinedOdds,
      combinedEdge,
      title: isSameMatch ? `Bet Builder (${Array.from(matchStrs)[0]})` : `Multipla Mista`,
      matches: Array.from(matchStrs).join(' + '),
      name: selectedBets.map(b => b.name).join(' + '),
      bookmaker: selectedBets[0].bookmaker // assuming same bookie
    };
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">🔮 Scanner Value Bets</h1>
            <p className="page-subtitle">Tutte le opportunità con Edge positivo trovate nelle partite in coda.</p>
          </div>
          <div>
            <button className="btn btn-secondary" onClick={fetchValueBets} disabled={loading}>
              🔄 Aggiorna
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-container">
            <span className="loading-spinner" /> Elaborazione Database in corso...
          </div>
        ) : bets.length === 0 ? (
          <div className="empty-state card">
            <h2>Nessuna scommessa trovata</h2>
            <p>Non ci sono quote analizzate con vantaggio matematico al momento. Cerca alcune partite nella sezione Analisi e inserisci le quote!</p>
          </div>
        ) : (
          <div className="table-container" style={{ maxHeight: '78vh', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Partita</th>
                  <th>Scommessa</th>
                  <th>Cat.</th>
                  <th>EV</th>
                  <th>SD</th>
                  <th>CV</th>
                  <th>Prob.</th>
                  <th>Edge Max</th>
                  <th>Quote (Clicca per Multipla)</th>
                  <th>Stats Storiche</th>
                  <th>Azione</th>
                </tr>
              </thead>
              <tbody>
                {bets.map((bet, i) => {
                  const key = `${bet.matchKey}-${bet.name}`;
                  const isSelectedSportium = selectedBets.some(b => b.selectionKey === `${key}-Sportium`);
                  const isSelectedSportbet = selectedBets.some(b => b.selectionKey === `${key}-Sportbet`);
                  const hasSelection = isSelectedSportium || isSelectedSportbet;
                  
                  return (
                  <tr key={`${key}-${i}`} className={hasSelection ? 'row-highlight' : ''}>
                    <td style={{ fontWeight: 600, fontSize: 13, color: 'var(--blue)' }}>{bet.matchStr}</td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{bet.name}</td>
                    <td><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{bet.category}</span></td>
                    <td>{bet.ev}</td>
                    <td>{bet.sd}</td>
                    <td>{(bet.cv * 100).toFixed(1)}%</td>
                    <td style={{ fontWeight: 600 }}>{(bet.probability * 100).toFixed(1)}%</td>
                    <td>
                      <span className="edge-indicator positive">
                        {(bet.edge * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {bet.odds_sportium && (
                          <div 
                            onClick={() => toggleBetSelection(bet, 'Sportium')}
                            style={{ 
                              padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                              opacity: selectedBets.length > 0 && selectedBets[0].bookmaker !== 'Sportium' ? 0.3 : 1,
                              background: isSelectedSportium ? 'var(--primary)' : 'transparent',
                              transition: 'all 0.2s', textAlign: 'center', minWidth: '60px'
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 13, color: isSelectedSportium ? '#fff' : 'var(--text-primary)' }}>{bet.odds_sportium.toFixed(2)}</div>
                            <div style={{ fontSize: 9, color: isSelectedSportium ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>SPORTIUM</div>
                          </div>
                        )}
                        {bet.odds_sportbet && (
                          <div 
                            onClick={() => toggleBetSelection(bet, 'Sportbet')}
                            style={{ 
                              padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
                              opacity: selectedBets.length > 0 && selectedBets[0].bookmaker !== 'Sportbet' ? 0.3 : 1,
                              background: isSelectedSportbet ? 'var(--primary)' : 'transparent',
                              transition: 'all 0.2s', textAlign: 'center', minWidth: '60px'
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 13, color: isSelectedSportbet ? '#fff' : 'var(--text-primary)' }}>{bet.odds_sportbet.toFixed(2)}</div>
                            <div style={{ fontSize: 9, color: isSelectedSportbet ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>SPORTBET</div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <button 
                         className="btn btn-secondary btn-sm" 
                         onClick={() => setHistoryModal({ bet })}
                         style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255, 255, 255, 0.05)' }}>
                        📊 Storico
                      </button>
                    </td>
                    <td>
                      <button 
                         className="btn btn-success btn-sm" 
                         onClick={() => setBetModal({ bet, stake: 1 })}>
                        Gioca
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}

        {/* Sticky Bet Builder Drawer */}
        {selectedBets.length > 0 && (
          <div style={{
            position: 'fixed',
            bottom: 0, left: 240, right: 0,
            background: 'var(--bg-card)',
            borderTop: '1px solid var(--border)',
            padding: '16px 24px',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                {getMultiplierStats().title} ({selectedBets.length} Selezioni)
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '800px' }}>
                {getMultiplierStats().name}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Probabilità</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{(getMultiplierStats().combinedProb * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quota Totale</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{getMultiplierStats().combinedOdds.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Edge Totale</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: getMultiplierStats().combinedEdge > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {(getMultiplierStats().combinedEdge * 100).toFixed(1)}%
                </div>
              </div>
              <button 
                className="btn btn-primary"
                onClick={() => {
                  const m = getMultiplierStats();
                  const multiBet = {
                    league: selectedBets[0].league, // assume primary league
                    matchStr: m.matches, // potenziale misto
                    name: m.name,
                    category: 'Multipla',
                    ev: 0, sd: 0, cv: 0, // Dati aggregati omettevoli
                    probability: m.combinedProb,
                    fairOdds: 1 / m.combinedProb,
                    minOdds: 0, // Workaround SQLite NOT NULL constraint
                    actualOdds: m.combinedOdds,
                    bookmaker: m.bookmaker,
                    edge: m.combinedEdge
                  };
                  setBetModal({ bet: multiBet, stake: 1 });
                }}
              >
                Gioca Multipla 🚀
              </button>
            </div>
          </div>
        )}

        {/* Modal Storico Stagionale */}
        {historyModal && (
          <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                  Storico Stagionale
                </div>
                <h2 style={{ fontSize: 20 }}>{historyModal.bet.name}</h2>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Partita: {historyModal.bet.matchStr}
                </div>
              </div>

              <div style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                {/* HTML Iniettato in sicurezza perché proveniente dall'API protetta */}
                <div dangerouslySetInnerHTML={{ __html: historyModal.bet.historyMessage }} />
              </div>

              <div className="form-actions" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setHistoryModal(null)}>Chiudi Finestra</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Scommessa */}
        {betModal && (
          <div className="modal-overlay" onClick={() => setBetModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2 className="modal-title">🎯 Conferma Scommessa da Scanner</h2>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{betModal.bet.matchStr}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{betModal.bet.name}</div>
              </div>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quota</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{betModal.bet.actualOdds}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Edge</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                    {(betModal.bet.edge * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="input-group" style={{ marginTop: 16 }}>
                <label>Stake (€)</label>
                <input 
                  type="number" 
                  value={betModal.stake} 
                  min="1" 
                  step="0.5" 
                  onChange={e => setBetModal({ ...betModal, stake: parseFloat(e.target.value) })} 
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Bookmaker: <strong>{betModal.bet.bookmaker}</strong>
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => setBetModal(null)} style={{ flex: 1 }}>Annulla</button>
                <button className="btn btn-success" onClick={() => placeBet(betModal.bet, betModal.stake)} style={{ flex: 1 }}>✅ Aggiungi a Tracker</button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>
            {toast.message}
          </div>
        )}
      </main>
    </div>
  );
}

export default function ValueBetsPage() {
  return (
    <Suspense fallback={<div className="loading-container"><span className="loading-spinner" /> Caricamento...</div>}>
      <ValueBetsContent />
    </Suspense>
  );
}
