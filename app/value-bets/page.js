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
                  <th style={{ color: 'var(--green)' }}>Hist%</th>
                  <th style={{ color: 'var(--orange, #f59e0b)' }}>Form%</th>
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
                  <tr key={`${key}-${i}`} className={hasSelection ? 'row-highlight' : ''} style={{ opacity: bet.inGioco ? 0.38 : 1, pointerEvents: bet.inGioco ? 'none' : 'auto' }}>
                    <td style={{ fontWeight: 600, fontSize: 13, color: 'var(--blue)' }}>
                      {bet.matchStr}
                      {bet.inGioco && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--red)', color: '#fff', padding: '2px 5px', borderRadius: 4, fontWeight: 700, verticalAlign: 'middle' }}>🔴 IN GIOCO</span>}
                    </td>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {bet.histScore !== null ? (
                          <span style={{ fontWeight: 700, fontSize: 13, color: bet.histScore >= 0.65 ? 'var(--green)' : bet.histScore >= 0.50 ? 'var(--accent-secondary)' : 'var(--red)' }}>
                            {Math.round(bet.histScore * 100)}%
                          </span>
                        ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {bet.formScore !== null ? (
                          <span style={{ fontWeight: 700, fontSize: 13, color: bet.formScore >= 0.65 ? 'var(--green)' : bet.formScore >= 0.50 ? 'var(--accent-secondary)' : 'var(--red)' }}>
                            {Math.round(bet.formScore * 100)}%
                          </span>
                        ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                           className="btn btn-secondary btn-sm" 
                           onClick={() => setHistoryModal({ bet })}
                           style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(255, 255, 255, 0.05)' }}>
                          📊 Dettagli
                        </button>
                        <button 
                           className="btn btn-success btn-sm" 
                           onClick={() => setBetModal({ bet, stake: 1 })}>
                          Gioca
                        </button>
                      </div>
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

        {/* Modal Storico + Forma Scanner */}
        {historyModal && (() => {
          const b = historyModal.bet;
          const fmtPct = (v) => v !== null && v !== undefined ? `${Math.round(v * 100)}%` : '—';
          const histColor = (v) => v === null || v === undefined ? 'var(--text-muted)'
            : v >= 0.65 ? 'var(--green)' : v >= 0.50 ? 'var(--accent-secondary)' : 'var(--red)';
            
          return (
            <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 18 }}>
                  <div style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                    Storico & Forma — Scanner
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{b.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {b.matchStr}
                  </div>
                </div>

                {/* Hist Score globale */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>Punteggio Storico Aggregato</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: histColor(b.histScore) }}>
                    {fmtPct(b.histScore)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    (Senza arbitro: 50% / 50% — Con arbitro: 25% / 25% / 50%)
                  </div>
                </div>

                {/* Dettagli Storico */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Dettaglio Storico Stagionale
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ padding: '12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {b.homeTeam}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: histColor(b.hist?.homePct) }}>{fmtPct(b.hist?.homePct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>in casa</div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{b.hist?.homeSample ?? 0} partite</div>
                      {b.hist?.homePctOverall !== null && b.hist?.homePctOverall !== undefined && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: histColor(b.hist?.homePctOverall) }}>{fmtPct(b.hist?.homePctOverall)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>totali</div>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{b.hist?.homeSampleOverall ?? 0} partite</div>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>✈️ {b.awayTeam}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: histColor(b.hist?.awayPct) }}>{fmtPct(b.hist?.awayPct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>in trasferta</div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{b.hist?.awaySample ?? 0} partite</div>
                      {b.hist?.awayPctOverall !== null && b.hist?.awayPctOverall !== undefined && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: histColor(b.hist?.awayPctOverall) }}>{fmtPct(b.hist?.awayPctOverall)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>totali</div>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{b.hist?.awaySampleOverall ?? 0} partite</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {b.hist?.refPct !== null && b.hist?.refPct !== undefined && (
                    <div style={{ padding: '12px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: 8, border: '1px dashed var(--green)', marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Arbitro</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: histColor(b.hist.refPct) }}>
                        {fmtPct(b.hist.refPct)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        Campione: {b.hist.refSample} match
                      </div>
                    </div>
                  )}
                </div>

                {/* Dettagli Forma */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Stato di Forma (Ultime 5 partite)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ padding: '12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {b.homeTeam}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: histColor(b.form?.homeFormPct) }}>{fmtPct(b.form?.homeFormPct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ult. in casa</div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>su {b.form?.homeN ?? '—'} match</div>
                      {b.form?.homeGenFormPct !== null && b.form?.homeGenFormPct !== undefined && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: histColor(b.form?.homeGenFormPct) }}>{fmtPct(b.form?.homeGenFormPct)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ult. ovunque</div>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>su {b.form?.homeGenN ?? '—'} match</div>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>✈️ {b.awayTeam}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: histColor(b.form?.awayFormPct) }}>{fmtPct(b.form?.awayFormPct)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ult. in trasf.</div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>su {b.form?.awayN ?? '—'} match</div>
                      {b.form?.awayGenFormPct !== null && b.form?.awayGenFormPct !== undefined && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: histColor(b.form?.awayGenFormPct) }}>{fmtPct(b.form?.awayGenFormPct)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ult. ovunque</div>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>su {b.form?.awayGenN ?? '—'} match</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={() => setHistoryModal(null)}>Chiudi Dettagli</button>
                </div>
              </div>
            </div>
          );
        })()}

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
                  value={isNaN(betModal.stake) ? '' : betModal.stake} 
                  min="1" 
                  step="0.5" 
                  onChange={e => setBetModal({ ...betModal, stake: e.target.value === '' ? '' : parseFloat(e.target.value) })} 
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
