'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

const LEAGUES = [
  { id: 'SerieA', name: 'Serie A' },
  { id: 'Premier', name: 'Premier League' },
  { id: 'LaLiga', name: 'La Liga' },
  { id: 'Ligue1', name: 'Ligue 1' },
  { id: 'Bundes', name: 'Bundesliga' },
];

const CATEGORIES = ['Tutti', 'Gol', 'Tiri', 'Tiri in Porta', 'Falli', 'Corner', 'Cartellini', 'Parate'];
const STATS_LIST = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate'];

function AnalysisContent() {
  const searchParams = useSearchParams();

  const [league, setLeague] = useState(searchParams.get('league') || '');
  const [homeTeam, setHomeTeam] = useState(searchParams.get('home') || '');
  const [awayTeam, setAwayTeam] = useState(searchParams.get('away') || '');
  const [referee, setReferee] = useState('');
  const [teams, setTeams] = useState([]);
  const [referees, setReferees] = useState([]);
  const [pendingMatches, setPendingMatches] = useState([]);
  
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('Tutti');
  const [showOnlyValue, setShowOnlyValue] = useState(false);
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState({ column: 'defaultOrder', direction: 'asc' });
  const [highlightedRow, setHighlightedRow] = useState(null);

  // Odds state
  const [odds, setOdds] = useState({});
  const [activeEditOdds, setActiveEditOdds] = useState({});
  const [savingOdds, setSavingOdds] = useState(false);

  // Refs for fast keyboard navigation
  const oddsInputRefs = useRef({});

  // Modals and Toasts
  const [betModal, setBetModal] = useState(null);
  const [toast, setToast] = useState(null);

  const matchKey = league && homeTeam && awayTeam ? `${league}|${homeTeam}|${awayTeam}` : null;

  useEffect(() => {
    loadTeams();
  }, []);

  useEffect(() => {
    if (league && homeTeam && awayTeam) {
      runAnalysis();
    }
  }, []);

  // When match changes, clear odds until re-fetched
  useEffect(() => {
    setOdds({});
    setActiveEditOdds({});
    setResults(null);
  }, [league, homeTeam, awayTeam]);

  async function loadTeams() {
    try {
      const res = await fetch('/api/matches');
      const data = await res.json();
      setTeams(data.teams || []);
      setReferees(data.referees || []);
    } catch (e) { console.error(e); }
    fetchPendingMatches();
  }

  async function fetchPendingMatches() {
    try {
      const res = await fetch('/api/pending-matches');
      const data = await res.json();
      setPendingMatches(data.pendingMatches || []);
    } catch (e) { console.error('Errore pending matches:', e); }
  }

  async function deletePendingMatch(matchKey) {
    if (!confirm('Vuoi davvero eliminare questa partita dal menu Pending? Tutte le quote salvate per questa partita andranno perse.')) return;
    try {
      const res = await fetch(`/api/pending-matches?matchKey=${encodeURIComponent(matchKey)}`, { method: 'DELETE' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Il server non ha risposto correttamente (possibile disconnessione o errore del server).'); }
      
      if (res.ok) {
        setToast({ type: 'success', message: 'Partita eliminata dal pending.' });
        fetchPendingMatches();
      } else {
        setToast({ type: 'error', message: data.error || 'Errore durante l\'eliminazione' });
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  async function loadPendingMatch(pm) {
    setLeague(pm.league);
    setHomeTeam(pm.home_team);
    setAwayTeam(pm.away_team);
    setReferee(pm.referee || '');
    runAnalysis(pm.league, pm.home_team, pm.away_team, pm.referee || '');
  }

  async function runAnalysis(l = league, h = homeTeam, a = awayTeam, r = referee) {
    if (!l || !h || !a) return;
    setLoading(true);
    try {
      // Fetch analysis results
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league: l, homeTeam: h, awayTeam: a, referee: r }),
      });
      const data = await res.json();
      
      if (data.error) {
        setToast({ type: 'error', message: data.error });
        setLoading(false);
        return;
      }
      
      
      // Fetch odds from DB
      const oddsRes = await fetch(`/api/analysis/odds?matchKey=${encodeURIComponent(`${l}|${h}|${a}`)}`);
      if (oddsRes.ok) {
        const oddsData = await oddsRes.json();
        const loadedOdds = {};
        const loadedActiveOdds = {};
        for (const o of oddsData.odds) {
          loadedOdds[o.market_name] = {};
          loadedActiveOdds[o.market_name] = {};
          if (o.sportium) {
            loadedOdds[o.market_name].sportium = o.sportium;
            loadedActiveOdds[o.market_name].sportium = o.sportium;
          }
          if (o.sportbet) {
            loadedOdds[o.market_name].sportbet = o.sportbet;
            loadedActiveOdds[o.market_name].sportbet = o.sportbet;
          }
        }
        setOdds(loadedOdds);
        setActiveEditOdds(loadedActiveOdds);
      }

      setResults(data);
      fetchPendingMatches(); // Refresh pending matches list
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
    setLoading(false);
  }

  // Handle typing odds (only updates activeEditOdds)
  function handleOddsChange(marketName, bookmaker, value) {
    setActiveEditOdds(prev => ({
      ...prev,
      [marketName]: { ...prev[marketName], [bookmaker]: value ? parseFloat(value) : '' }
    }));
  }

  // Fast keyboard navigation for odds inputs
  function handleOddsKeyDown(e, marketName, bookmaker) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
      // Move to next row in same column
      const marketNames = displayMarkets.filter(m => !m.isDiscarded).map(m => m.name);
      const currentIdx = marketNames.indexOf(marketName);
      const nextIdx = currentIdx + 1;
      if (nextIdx < marketNames.length) {
        const nextKey = `${marketNames[nextIdx]}_${bookmaker}`;
        setTimeout(() => {
          oddsInputRefs.current[nextKey]?.focus();
          oddsInputRefs.current[nextKey]?.select();
        }, 50);
      } else if (bookmaker === 'sportium' && marketNames.length > 0) {
        // End of Sportium column → jump to first Sportbet
        const firstKey = `${marketNames[0]}_sportbet`;
        setTimeout(() => {
          oddsInputRefs.current[firstKey]?.focus();
          oddsInputRefs.current[firstKey]?.select();
        }, 50);
      }
    } else if (e.key === '0' && e.target.value === '') {
      // Quick skip on empty field → move to next
      e.preventDefault();
      const marketNames = displayMarkets.filter(m => !m.isDiscarded).map(m => m.name);
      const currentIdx = marketNames.indexOf(marketName);
      const nextIdx = currentIdx + 1;
      if (nextIdx < marketNames.length) {
        const nextKey = `${marketNames[nextIdx]}_${bookmaker}`;
        setTimeout(() => {
          oddsInputRefs.current[nextKey]?.focus();
          oddsInputRefs.current[nextKey]?.select();
        }, 50);
      } else if (bookmaker === 'sportium' && marketNames.length > 0) {
        const firstKey = `${marketNames[0]}_sportbet`;
        setTimeout(() => {
          oddsInputRefs.current[firstKey]?.focus();
          oddsInputRefs.current[firstKey]?.select();
        }, 50);
      }
    }
  }

  // Register ref for an odds input
  function setOddsRef(marketName, bookmaker, el) {
    oddsInputRefs.current[`${marketName}_${bookmaker}`] = el;
  }

  // Handle blurring odds (commits to odds state, triggers re-sort, saves to DB, and flashes row)
  async function handleOddsBlur(marketName, bookmaker, value) {
    const numValue = value ? parseFloat(value) : null;
    const currentStoredValue = odds[marketName]?.[bookmaker] || null;

    if (numValue === currentStoredValue) return; // No change

    setOdds(prev => ({
      ...prev,
      [marketName]: { ...prev[marketName], [bookmaker]: numValue }
    }));

    // Trigger highlight
    setHighlightedRow(marketName);
    setTimeout(() => {
      setHighlightedRow(curr => curr === marketName ? null : curr);
    }, 2000);

    // Save to DB
    if (matchKey) {
      const sportiumVal = bookmaker === 'sportium' ? numValue : (odds[marketName]?.sportium || null);
      const sportbetVal = bookmaker === 'sportbet' ? numValue : (odds[marketName]?.sportbet || null);
      
      try {
        await fetch('/api/analysis/odds', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchKey, marketName, sportium: sportiumVal, sportbet: sportbetVal
          })
        });
      } catch (e) { console.error('Failed to save odds:', e); }
    }
  }



  async function clearAllOdds() {
    if (!matchKey) return;
    if (!confirm('Vuoi davvero cancellare tutte le quote per questa partita?')) return;
    
    try {
      await fetch(`/api/analysis/odds?matchKey=${encodeURIComponent(matchKey)}`, { method: 'DELETE' });
      setOdds({});
      setActiveEditOdds({});
      setHighlightedRow(null);
      setToast({ type: 'success', message: 'Quote cancellate.' });
      runAnalysis(); // re-fetch to clear custom bets from UI
    } catch (e) {
      setToast({ type: 'error', message: 'Errore durante la cancellazione' });
    }
  }

  async function swapTeams() {
    if (!league || !homeTeam || !awayTeam) return;
    setLoading(true);
    try {
      const res = await fetch('/api/analysis/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, homeTeam, awayTeam }),
      });
      const text = await res.text();
      let data;
      try { 
        data = JSON.parse(text); 
      } catch(e) { 
        throw new Error('Endpoint non trovato o server in crash. Riavvia Next.js (Ctrl+C e npm run dev)'); 
      }
      
      if (data.error) throw new Error(data.error);

      // Successfully swapped in backend. Update UI state internally.
      setHomeTeam(data.newHome);
      setAwayTeam(data.newAway);
      setToast({ type: 'success', message: '✅ Squadre e Quote invertite con successo!' });
      
      // Auto-run analysis with new properties
      runAnalysis(league, data.newHome, data.newAway, referee);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
      setLoading(false);
    }
  }

  function getEdge(probability, oddsValue) {
    if (!oddsValue || !probability) return null;
    return (probability * oddsValue) - 1;
  }

  function getBestEdge(marketName, probability) {
    const o = odds[marketName];
    if (!o) return null;
    const edges = [];
    if (o.sportium) edges.push({ edge: getEdge(probability, o.sportium), book: 'Sportium', odds: o.sportium });
    if (o.sportbet) edges.push({ edge: getEdge(probability, o.sportbet), book: 'Sportbet', odds: o.sportbet });
    if (edges.length === 0) return null;
    return edges.reduce((best, e) => (!best || e.edge > best.edge) ? e : best, null);
  }

  async function placeBet(market, bestEdge) {
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          league,
          match_description: `${homeTeam} - ${awayTeam}`,
          bet_name: market.name,
          bet_category: market.category,
          ev: market.ev,
          sd: market.sd,
          cv: market.cv,
          probability: market.probability,
          fair_odds: market.fairOdds,
          min_odds: market.minOdds,
          actual_odds: bestEdge.odds,
          bookmaker: bestEdge.book,
          edge: bestEdge.edge,
          stake: betModal?.stake || 1,
          stake_kelly: betModal?.kellyStake || null,
          referee_rating: results?.refereeRating?.falli || null,
        }),
      });
      if (res.ok) {
        setToast({ type: 'success', message: `✅ Bet salvata: ${market.name}` });
        setBetModal(null);
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  const handleSort = (column) => {
    let direction = 'desc';
    if (sortConfig.column === column && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ column, direction });
  };

  const leagueTeams = teams.filter(t => t.league === league).map(t => t.name);
  const leagueReferees = referees.filter(r => r.league === league).map(r => r.referee);

  // Filter 
  let displayMarkets = results?.markets || [];
  if (filterCategory !== 'Tutti') {
    displayMarkets = displayMarkets.filter(m => m.category === filterCategory);
  }
  if (showOnlyValue) {
    displayMarkets = displayMarkets.filter(m => !m.isDiscarded);
  }

  // Sort
  displayMarkets = [...displayMarkets].sort((a, b) => {
    const valA = a[sortConfig.column];
    const valB = b[sortConfig.column];
    const edgeObjA = getBestEdge(a.name, a.probability);
    const edgeObjB = getBestEdge(b.name, b.probability);
    
    let sortValA, sortValB;

    if (sortConfig.column === 'edge') {
      sortValA = edgeObjA ? edgeObjA.edge : -999;
      sortValB = edgeObjB ? edgeObjB.edge : -999;
    } else {
      sortValA = valA;
      sortValB = valB;
    }

    if (sortValA < sortValB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (sortValA > sortValB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const SorterIcon = ({ column }) => {
    if (sortConfig.column !== column) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4 }}>{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1 className="page-title">⚽ Analisi Partita</h1>
          <p className="page-subtitle">Seleziona campionato e squadre per generare l'analisi</p>
        </div>

        {/* Pending Matches */}
        {pendingMatches.length > 0 && (
          <div className="card" style={{ marginBottom: 24, padding: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 12 }}>
              ⏱️ Analisi in Pending
            </div>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
              {pendingMatches.map(pm => (
                <div key={pm.match_key} style={{ position: 'relative', display: 'flex' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px', paddingRight: '28px' }}
                    onClick={() => loadPendingMatch(pm)}
                  >
                    <strong style={{ fontSize: 13 }}>{pm.home_team} - {pm.away_team}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pm.league} • {pm.odds_count} quote • Arb: {pm.referee || 'N/A'}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deletePendingMatch(pm.match_key); }}
                    style={{ position: 'absolute', top: 4, right: 4, background: 'var(--bg-card)', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--red)', fontSize: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                    title="Elimina partita e quote in sospeso"
                  >
                    ✖
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input Form */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="form-row">
            <div className="input-group">
              <label>Campionato</label>
              <select value={league} onChange={e => { setLeague(e.target.value); setHomeTeam(''); setAwayTeam(''); setReferee(''); }}>
                <option value="">Seleziona...</option>
                {LEAGUES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Squadra Casa</label>
              <select value={homeTeam} onChange={e => setHomeTeam(e.target.value)}>
                <option value="">Seleziona...</option>
                {leagueTeams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Squadra Ospite</label>
              <select value={awayTeam} onChange={e => setAwayTeam(e.target.value)}>
                <option value="">Seleziona...</option>
                {leagueTeams.filter(t => t !== homeTeam).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Arbitro (opz.)</label>
              <select value={referee} onChange={e => setReferee(e.target.value)}>
                <option value="">Nessuno</option>
                {leagueReferees.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={() => runAnalysis()} disabled={!league || !homeTeam || !awayTeam || loading} style={{ flex: 1 }}>
              {loading ? <><span className="loading-spinner" /> Elaborazione...</> : '🔍 Genera Analisi'}
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => swapTeams()} disabled={!league || !homeTeam || !awayTeam || loading} title="Inverti Casa/Trasferta senza perdere le quote" style={{ padding: '0 16px' }}>
              🔄 Scambia
            </button>
          </div>
        </div>

        {/* Results */}
        {results && (
          <>
            {/* Stats Overview */}
            <div className="card" style={{ marginBottom: 24, padding: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                📊 Stime EV e Volatilità (SD)
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
                {STATS_LIST.map(stat => {
                  const s = results.evsd[stat];
                  if (!s) return null;
                  return (
                    <div key={stat} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg-card-hover)', width: '230px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', textAlign: 'center', marginBottom: 16, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                        {stat}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ textAlign: 'center', flex: 1 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {homeTeam}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{s.casa.ev.toFixed(2)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>(±{s.casa.sd.toFixed(2)})</div>
                        </div>
                        
                        <div style={{ width: 1, background: 'var(--border)', margin: '0 8px' }} />

                        <div style={{ textAlign: 'center', flex: 1 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>✈️ {awayTeam}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{s.ospite.ev.toFixed(2)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>(±{s.ospite.sd.toFixed(2)})</div>
                        </div>
                      </div>

                      {stat !== 'parate' && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Totale</div>
                          <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                            <strong style={{ color: 'var(--blue)' }}>{s.totale.ev.toFixed(2)}</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(±{s.totale.sd.toFixed(2)})</span>
                          </div>
                        </div>
                      )}

                      {/* Info Arbitro per Falli e Cartellini */}
                      {results.matchInfo?.referee && (stat === 'falli' || stat === 'cartellini') && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 6, padding: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Moltiplicatore Arbitro</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: results.refereeRating[stat] > 1 ? 'var(--green)' : results.refereeRating[stat] < 1 ? 'var(--red)' : 'var(--text-primary)' }}>
                            x{results.refereeRating[stat].toFixed(2)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Filter Bar */}
            <div className="filter-bar">
              <label>Categoria:</label>
              <div className="toggle-group">
                {CATEGORIES.map(c => (
                  <button key={c} className={`toggle-btn ${filterCategory === c ? 'active' : ''}`} onClick={() => setFilterCategory(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <label style={{ marginLeft: '12px', display: 'flex', alignItems: 'center' }}>
                <input type="checkbox" checked={showOnlyValue} onChange={e => setShowOnlyValue(e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />
                Solo Value Bet
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button className="btn btn-danger btn-sm" onClick={clearAllOdds} disabled={Object.keys(odds).length === 0}>
                  🗑️ Cancella Quote
                </button>
              </div>
            </div>

            {/* Markets Table */}
            <div className="table-container" style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th onClick={() => handleSort('defaultOrder')} style={{ cursor: 'pointer' }}>Scommessa <SorterIcon column="defaultOrder" /></th>
                    <th onClick={() => handleSort('category')} style={{ cursor: 'pointer' }}>Cat. <SorterIcon column="category" /></th>
                    <th onClick={() => handleSort('ev')} style={{ cursor: 'pointer' }}>EV <SorterIcon column="ev" /></th>
                    <th onClick={() => handleSort('sd')} style={{ cursor: 'pointer' }}>SD <SorterIcon column="sd" /></th>
                    <th onClick={() => handleSort('cv')} style={{ cursor: 'pointer' }}>CV <SorterIcon column="cv" /></th>
                    <th onClick={() => handleSort('probability')} style={{ cursor: 'pointer' }}>Prob. <SorterIcon column="probability" /></th>
                    <th>Quota Min.</th>
                    <th>Sportium</th>
                    <th>Sportbet</th>
                    <th onClick={() => handleSort('edge')} style={{ cursor: 'pointer' }}>Edge <SorterIcon column="edge" /></th>
                    <th>Stato</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {displayMarkets.map((m, i) => {
                    const bestEdge = getBestEdge(m.name, m.probability);
                    const isHighlighted = highlightedRow === m.name;
                    return (
                      <tr 
                        key={m.name} 
                        style={{ opacity: m.isDiscarded ? 0.4 : 1 }}
                        className={isHighlighted ? 'row-highlight' : ''}
                      >
                        <td style={{ fontWeight: 600, fontSize: 12 }}>
                          {m.name} {m.isCustom && <span style={{ color: 'var(--blue)', fontSize: 10 }}>(Custom)</span>}
                        </td>
                        <td><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.category}</span></td>
                        <td>{m.ev}</td>
                        <td>{m.sd}</td>
                        <td>{(m.cv * 100).toFixed(0)}%</td>
                        <td style={{ fontWeight: 600 }}>{(m.probability * 100).toFixed(1)}%</td>
                        <td style={{ fontWeight: 600, color: 'var(--accent-secondary)' }}>
                          {m.minOdds || '—'}
                        </td>
                        <td>
                          {!m.isDiscarded && (
                            <input
                              type="number"
                              className={`odds-input ${odds[m.name]?.sportium ? 'has-value' : ''}`}
                              step="0.01"
                              min="1"
                              placeholder="—"
                              ref={el => setOddsRef(m.name, 'sportium', el)}
                              value={activeEditOdds[m.name]?.sportium !== undefined ? activeEditOdds[m.name]?.sportium : ''}
                              onChange={e => handleOddsChange(m.name, 'sportium', e.target.value)}
                              onBlur={e => handleOddsBlur(m.name, 'sportium', e.target.value)}
                              onKeyDown={e => handleOddsKeyDown(e, m.name, 'sportium')}
                            />
                          )}
                        </td>
                        <td>
                          {!m.isDiscarded && (
                            <input
                              type="number"
                              className={`odds-input ${odds[m.name]?.sportbet ? 'has-value' : ''}`}
                              step="0.01"
                              min="1"
                              placeholder="—"
                              ref={el => setOddsRef(m.name, 'sportbet', el)}
                              value={activeEditOdds[m.name]?.sportbet !== undefined ? activeEditOdds[m.name]?.sportbet : ''}
                              onChange={e => handleOddsChange(m.name, 'sportbet', e.target.value)}
                              onBlur={e => handleOddsBlur(m.name, 'sportbet', e.target.value)}
                              onKeyDown={e => handleOddsKeyDown(e, m.name, 'sportbet')}
                            />
                          )}
                        </td>
                        <td>
                          {bestEdge && (
                            <span className={`edge-indicator ${bestEdge.edge >= 0 ? 'positive' : 'negative'}`}>
                              {(bestEdge.edge * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td>
                          {m.isDiscarded ? (
                            <span className="badge badge-discard">SCARTATA</span>
                          ) : bestEdge && bestEdge.edge >= (results.settings.minEdge || 0) ? (
                            <span className="badge badge-value">VALUE ✓</span>
                          ) : bestEdge && bestEdge.edge >= 0 ? (
                            <span className="badge badge-warning">MARGINAL</span>
                          ) : null}
                        </td>
                        <td>
                          {bestEdge && bestEdge.edge > 0 && (
                            <button className="btn btn-success btn-sm" onClick={() => setBetModal({ market: m, bestEdge, stake: 1, kellyStake: null })}>
                              Gioca
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
              Mostrando {displayMarkets.length} mercati
            </div>
          </>
        )}


        {/* Bet Modal */}
        {betModal && (
          <div className="modal-overlay" onClick={() => setBetModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2 className="modal-title">🎯 Conferma Scommessa</h2>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{homeTeam} vs {awayTeam}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{betModal.market.name}</div>
              </div>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quota</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{betModal.bestEdge.odds}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Edge</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                    {(betModal.bestEdge.edge * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="input-group" style={{ marginTop: 16 }}>
                <label>Stake (€)</label>
                <input type="number" value={betModal.stake} min="1" step="0.5" onChange={e => setBetModal({ ...betModal, stake: parseFloat(e.target.value) })} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Bookmaker: <strong>{betModal.bestEdge.book}</strong>
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => setBetModal(null)} style={{ flex: 1 }}>Annulla</button>
                <button className="btn btn-success" onClick={() => placeBet(betModal.market, betModal.bestEdge)} style={{ flex: 1 }}>✅ Conferma</button>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>
            {toast.message}
          </div>
        )}
      </main>
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="loading-container"><span className="loading-spinner" /> Caricamento...</div>}>
      <AnalysisContent />
    </Suspense>
  );
}
