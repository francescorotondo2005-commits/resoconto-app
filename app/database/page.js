'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

const LEAGUES = [
  { id: 'SerieA', name: 'Serie A' },
  { id: 'Premier', name: 'Premier League' },
  { id: 'LaLiga', name: 'La Liga' },
  { id: 'Ligue1', name: 'Ligue 1' },
  { id: 'Bundes', name: 'Bundesliga' },
];

const EMPTY_MATCH = {
  league: 'SerieA', matchday: '', date: new Date().toISOString().split('T')[0],
  home_team: '', away_team: '', home_goals: '', away_goals: '',
  home_shots: '', away_shots: '', home_sot: '', away_sot: '',
  home_fouls: '', away_fouls: '', home_corners: '', away_corners: '',
  home_yellows: '', away_yellows: '', home_reds: '', away_reds: '',
  home_saves: '', away_saves: '', referee: '',
};

export default function DatabasePage() {
  const [matches, setMatches] = useState([]);
  const [league, setLeague] = useState('SerieA');
  const [form, setForm] = useState({ ...EMPTY_MATCH });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [retraining, setRetraining] = useState(false);
  const [viewMode, setViewMode] = useState('add'); // 'add' | 'view' | 'import'
  const [editMatchId, setEditMatchId] = useState(null);
  const [sofaLoading, setSofaLoading] = useState(false);
  const [sofaData, setSofaData] = useState(null); // i 20 campi nascosti SofaScore
  const [showManual, setShowManual] = useState(false); // toggle per i campi manuali

  const [teams, setTeams] = useState([]);
  const [referees, setReferees] = useState([]);
  const [pendingMatches, setPendingMatches] = useState([]);

  useEffect(() => { 
    loadMatches(); 
  }, [league]);

  useEffect(() => { 
    loadTeams(); 
    fetchPendingMatches();
  }, []);

  async function fetchPendingMatches() {
    try {
      const res = await fetch('/api/pending-matches');
      const data = await res.json();
      setPendingMatches(data.pendingMatches || []);
    } catch (e) { console.error('Errore pending matches:', e); }
  }

  async function loadTeams() {
    try {
      const res = await fetch('/api/matches');
      const data = await res.json();
      setTeams(data.teams || []);
      setReferees(data.referees || []);
    } catch (e) { console.error(e); }
  }

  const leagueTeams = teams.filter(t => t.league === form.league).map(t => t.name);
  const leagueReferees = referees.filter(r => r.league === form.league).map(r => r.referee)

  async function loadMatches() {
    setLoading(true);
    try {
      const res = await fetch(`/api/matches?league=${league}&limit=50`);
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  function handleFormChange(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    // Se cambio squadra o data, invalida i dati SofaScore precedenti
    if (['home_team', 'away_team', 'date'].includes(field)) setSofaData(null);
  }

  async function fetchSofa() {
    if (!form.home_team || !form.away_team || !form.date) {
      setToast({ type: 'error', message: '⚠️ Inserisci squadra casa, ospite e data prima di recuperare da SofaScore.' });
      return;
    }
    setSofaLoading(true);
    setSofaData(null);
    try {
      console.log(`[SofaFetch] Richiesta manuale: "${form.home_team}" vs "${form.away_team}" del ${form.date}`);
      const res = await fetch('/api/sofascore-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_team: form.home_team, away_team: form.away_team, date: form.date }),
      });
      const json = await res.json();
      console.log('[SofaFetch] Risposta API completa:', json);
      if (!res.ok) {
        const debugInfo = json.debug ? `\nPartite SofaScore trovate per quella data: ${(json.debug.finishedGamesOnDate || []).join(' | ') || 'nessuna'}` : '';
        throw new Error((json.error || 'Errore fetch SofaScore') + debugInfo);
      }

      const d = json.data;
      // Pre-compila i 16 campi visibili del form
      setForm(prev => ({
        ...prev,
        home_goals:   d.home_goals ?? prev.home_goals,
        away_goals:   d.away_goals ?? prev.away_goals,
        home_shots:   d.home_shots ?? prev.home_shots,
        away_shots:   d.away_shots ?? prev.away_shots,
        home_sot:     d.home_sot   ?? prev.home_sot,
        away_sot:     d.away_sot   ?? prev.away_sot,
        home_fouls:   d.home_fouls ?? prev.home_fouls,
        away_fouls:   d.away_fouls ?? prev.away_fouls,
        home_corners: d.home_corners ?? prev.home_corners,
        away_corners: d.away_corners ?? prev.away_corners,
        home_yellows: d.home_yellows ?? prev.home_yellows,
        away_yellows: d.away_yellows ?? prev.away_yellows,
        home_reds:    d.home_reds   ?? prev.home_reds,
        away_reds:    d.away_reds   ?? prev.away_reds,
        home_saves:   d.home_saves  ?? prev.home_saves,
        away_saves:   d.away_saves  ?? prev.away_saves,
      }));
      // Salva silenziosamente i 20 campi SofaScore
      setSofaData({
        home_xg: d.home_xg, away_xg: d.away_xg,
        home_xg_ht: d.home_xg_ht, away_xg_ht: d.away_xg_ht,
        home_goals_ht: d.home_goals_ht, away_goals_ht: d.away_goals_ht,
        home_corners_ht: d.home_corners_ht, away_corners_ht: d.away_corners_ht,
        home_yellows_ht: d.home_yellows_ht, away_yellows_ht: d.away_yellows_ht,
        home_reds_ht: d.home_reds_ht, away_reds_ht: d.away_reds_ht,
        home_offsides: d.home_offsides, away_offsides: d.away_offsides,
        home_shots_insidebox: d.home_shots_insidebox, away_shots_insidebox: d.away_shots_insidebox,
        home_big_chances: d.home_big_chances, away_big_chances: d.away_big_chances,
        home_possession: d.home_possession, away_possession: d.away_possession,
      });
      setToast({ type: 'success', message: `✅ Dati SofaScore caricati per ${d.sofaHomeName} vs ${d.sofaAwayName}` });
    } catch (e) {
      setToast({ type: 'error', message: `❌ ${e.message}` });
    }
    setSofaLoading(false);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const url = '/api/matches';
      const method = editMatchId ? 'PATCH' : 'POST';
      
      const payload = {
        ...form,
        ...(sofaData || {}),        // ← merge silenzioso dei 20 campi SofaScore
        id: editMatchId,
        home_goals: Number(form.home_goals), away_goals: Number(form.away_goals),
        home_shots: Number(form.home_shots), away_shots: Number(form.away_shots),
        home_sot: Number(form.home_sot), away_sot: Number(form.away_sot),
        home_fouls: Number(form.home_fouls), away_fouls: Number(form.away_fouls),
        home_corners: Number(form.home_corners), away_corners: Number(form.away_corners),
        home_yellows: Number(form.home_yellows), away_yellows: Number(form.away_yellows),
        home_reds: Number(form.home_reds), away_reds: Number(form.away_reds),
        home_saves: form.home_saves ? Number(form.home_saves) : null,
        away_saves: form.away_saves ? Number(form.away_saves) : null,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setToast({ type: 'success', message: `✅ ${form.home_team} vs ${form.away_team} ${editMatchId ? 'modificata' : 'salvata'}!` });
        setForm({ ...EMPTY_MATCH, league: form.league, date: form.date });
        setSofaData(null);
        setEditMatchId(null);
        if (editMatchId) setViewMode('view');
        loadMatches();
        setTimeout(() => setToast(null), 3000);
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Errore salvataggio');
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      setImportResult(data);
      if (data.success) {
        setToast({ type: 'success', message: '✅ Import completato!' });
        loadMatches();
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
    setImporting(false);
  }

  async function handleDelete(id) {
    if (!confirm('Eliminare questa partita? Verrà cancellato anche il relativo backtest.')) return;
    try {
      await fetch('/api/matches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadMatches();
    } catch (e) { console.error(e); }
  }

  function handleEdit(m) {
    setForm(m);
    setEditMatchId(m.id);
    setViewMode('add');
  }

  async function loadPendingMatchIntoForm(pm) {
    const matchDate = pm.date
      ? pm.date.split('T')[0]
      : new Date().toISOString().split('T')[0];

    // 1. Pre-compila i campi base dal pending match
    setForm(prev => ({
      ...prev,
      league: pm.league,
      home_team: pm.home_team,
      away_team: pm.away_team,
      referee: pm.referee || '',
      date: matchDate,
    }));
    setSofaData(null);

    // 2. Fetch SofaScore direttamente, senza conferma
    setSofaLoading(true);
    try {
      console.log(`[SofaFetch] Richiesta: "${pm.home_team}" vs "${pm.away_team}" del ${matchDate}`);
      const res = await fetch('/api/sofascore-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_team: pm.home_team, away_team: pm.away_team, date: matchDate }),
      });
      const json = await res.json();
      console.log('[SofaFetch] Risposta API completa:', json);

      if (!res.ok) {
        const debugInfo = json.debug ? `\nPartite trovate su SofaScore: ${(json.debug.finishedGamesOnDate || []).join(', ') || 'nessuna'}` : '';
        throw new Error((json.error || 'Errore SofaScore') + debugInfo);
      }

      const d = json.data;
      console.log('[SofaFetch] Dati ricevuti:', d);
      setForm(prev => ({
        ...prev,
        home_goals:   d.home_goals ?? prev.home_goals,
        away_goals:   d.away_goals ?? prev.away_goals,
        home_shots:   d.home_shots ?? prev.home_shots,
        away_shots:   d.away_shots ?? prev.away_shots,
        home_sot:     d.home_sot   ?? prev.home_sot,
        away_sot:     d.away_sot   ?? prev.away_sot,
        home_fouls:   d.home_fouls ?? prev.home_fouls,
        away_fouls:   d.away_fouls ?? prev.away_fouls,
        home_corners: d.home_corners ?? prev.home_corners,
        away_corners: d.away_corners ?? prev.away_corners,
        home_yellows: d.home_yellows ?? prev.home_yellows,
        away_yellows: d.away_yellows ?? prev.away_yellows,
        home_reds:    d.home_reds   ?? prev.home_reds,
        away_reds:    d.away_reds   ?? prev.away_reds,
        home_saves:   d.home_saves  ?? prev.home_saves,
        away_saves:   d.away_saves  ?? prev.away_saves,
      }));
      setSofaData({
        home_xg: d.home_xg, away_xg: d.away_xg,
        home_xg_ht: d.home_xg_ht, away_xg_ht: d.away_xg_ht,
        home_goals_ht: d.home_goals_ht, away_goals_ht: d.away_goals_ht,
        home_corners_ht: d.home_corners_ht, away_corners_ht: d.away_corners_ht,
        home_yellows_ht: d.home_yellows_ht, away_yellows_ht: d.away_yellows_ht,
        home_reds_ht: d.home_reds_ht, away_reds_ht: d.away_reds_ht,
        home_offsides: d.home_offsides, away_offsides: d.away_offsides,
        home_shots_insidebox: d.home_shots_insidebox, away_shots_insidebox: d.away_shots_insidebox,
        home_big_chances: d.home_big_chances, away_big_chances: d.away_big_chances,
        home_possession: d.home_possession, away_possession: d.away_possession,
      });
      setToast({ type: 'success', message: `✅ Dati SofaScore: ${d.sofaHomeName} vs ${d.sofaAwayName}` });
    } catch (e) {
      console.error('[SofaFetch] Errore:', e.message);
      setToast({ type: 'error', message: `❌ ${e.message}` });
    }
    setSofaLoading(false);
    setTimeout(() => setToast(null), 6000);
  }

  async function handleExportDB() {
    setLoading(true);
    try {
       const res = await fetch('/api/matches?limit=99999');
       const data = await res.json();
       const exportMatches = data.matches || [];
       if (exportMatches.length === 0) throw new Error('Nessuna partita da esportare');
       
       const header = Object.keys(exportMatches[0]).join(',');
       const rows = exportMatches.map(m => Object.values(m).map(v => `"${v !== null ? String(v).replace(/"/g, '""') : ''}"`).join(','));
       const csv = [header, ...rows].join('\n');
       
       const blob = new Blob([csv], { type: 'text/csv' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `resoconto_matches_export.csv`;
       a.click();
       URL.revokeObjectURL(url);
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    setLoading(false);
  }

  async function handleExportBacktest() {
    setLoading(true);
    try {
       const res = await fetch('/api/backtest');
       const data = await res.json();
       const backtests = data.backtestBets || [];
       if (backtests.length === 0) throw new Error('Nessun backtest trovato da esportare');
       const columns = [
         ['match_key','Chiave Match'],['match_date','Data Match'],['bet_name','Scommessa'],
         ['bet_category','Categoria'],['probability','Probabilità'],['sportium','Sportium'],
         ['sportbet','Sportbet'],['best_edge','Edge MAX'],['outcome','Esito'],
         ['hist_score','Storico %'],['home_hist_pct','Storico Casa'],['home_hist_sample','Campione Casa'],
         ['away_hist_pct','Storico Ospite'],['away_hist_sample','Campione Ospite'],
         ['ref_hist_pct','Storico Arbitro'],['ref_hist_sample','Campione Arbitro'],
         ['form_home_pct','Forma Casa (ult.5)'],['form_home_n','N Forma Casa'],
         ['form_away_pct','Forma Ospite (ult.5)'],['form_away_n','N Forma Ospite'],
         ['form_ref_pct','Forma Arbitro (ult.5)'],['form_ref_n','N Forma Arbitro'],
       ];
       const header = columns.map(([,label]) => label).join(',');
       const rows = backtests.map(b => columns.map(([key]) => {
         const v = b[key];
         return v === null || v === undefined ? '""' : '"' + String(v).replace(/"/g,'""') + '"';
       }).join(','));
       const csv = [header, ...rows].join('\n');
       const blob = new Blob([csv], { type: 'text/csv' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = 'resoconto_backtest_export.csv';
       a.click();
       URL.revokeObjectURL(url);
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    setLoading(false);
  }

  async function handleRetrain() {
    setRetraining(true);
    setToast({ type: 'success', message: '🤖 Re-training avviato in background... (~30 secondi)' });
    try {
      const res = await fetch('/api/ml-retrain', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: '🤖 ' + data.message });
      } else {
        setToast({ type: 'error', message: data.message || 'Servizio ML non disponibile' });
      }
    } catch (e) {
      setToast({ type: 'error', message: 'Impossibile contattare il servizio ML: ' + e.message });
    }
    setRetraining(false);
  }

  function handleCancelEdit() {
    setForm({ ...EMPTY_MATCH, league: form.league, date: form.date });
    setEditMatchId(null);
    setViewMode('view');
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1 className="page-title">📊 Database</h1>
          <p className="page-subtitle">Gestisci i dati delle partite</p>
        </div>

        {/* Tab Toggle */}
        <div className="toggle-group" style={{ marginBottom: 24, width: 'fit-content' }}>
          <button className={`toggle-btn ${viewMode === 'add' ? 'active' : ''}`} onClick={() => setViewMode('add')}>➕ Aggiungi Partita</button>
          <button className={`toggle-btn ${viewMode === 'view' ? 'active' : ''}`} onClick={() => setViewMode('view')}>📋 Visualizza DB</button>
          <button className={`toggle-btn ${viewMode === 'import' ? 'active' : ''}`} onClick={() => setViewMode('import')}>📥 Import Excel</button>
        </div>

        {/* Add Match Form */}
        {viewMode === 'add' && (
          <>
            {pendingMatches.length > 0 && !editMatchId && (
              <div className="card" style={{ marginBottom: 24, padding: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 12 }}>
                  ⏱️ Compila da Analisi in Pending
                </div>
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
                  {pendingMatches.map(pm => (
                    <button
                      key={pm.match_key}
                      className="btn btn-secondary"
                      style={{ whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px', opacity: pm.in_gioco ? 0.5 : 1 }}
                      onClick={() => loadPendingMatchIntoForm(pm)}
                      type="button"
                    >
                      <strong style={{ fontSize: 13 }}>{pm.home_team} - {pm.away_team}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pm.league} • Arb: {pm.referee || 'N/A'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>
                {editMatchId ? '✏️ Modifica Risultato Partita' : 'Inserimento Rapido'}
              </h3>
              {editMatchId && (
                <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit}>
                  Annulla Modifica
                </button>
              )}
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="input-group">
                  <label>Campionato</label>
                  <select value={form.league} onChange={e => handleFormChange('league', e.target.value)}>
                    {LEAGUES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label>Data</label>
                  <input type="date" value={form.date} onChange={e => handleFormChange('date', e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Squadra Casa</label>
                  <input type="text" list="db-teams-list" value={form.home_team} onChange={e => handleFormChange('home_team', e.target.value)} placeholder="es. Sassuolo" required />
                </div>
                <div className="input-group">
                  <label>Squadra Ospite</label>
                  <input type="text" list="db-teams-list" value={form.away_team} onChange={e => handleFormChange('away_team', e.target.value)} placeholder="es. Cagliari" required />
                </div>
              </div>

              {/* Pulsante SofaScore — visibile quando i 3 campi chiave sono compilati */}
              {form.home_team && form.away_team && form.date && (
                <div style={{ margin: '8px 0 16px' }}>
                  <button
                    type="button"
                    id="sofa-fetch-btn"
                    className={`btn btn-primary btn-sm`}
                    onClick={fetchSofa}
                    disabled={sofaLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {sofaLoading
                      ? <><span className="loading-spinner" /> Recupero da SofaScore...</>
                      : '🔄 Recupera statistiche da SofaScore'}
                  </button>
                  {sofaData && (
                    <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--accent-green, #22c55e)', fontWeight: 600 }}>
                      ✅ xG: {sofaData.home_xg ?? '—'} – {sofaData.away_xg ?? '—'} &nbsp;|&nbsp;
                      Possesso: {sofaData.home_possession ?? '—'}% – {sofaData.away_possession ?? '—'}%
                    </span>
                  )}
                </div>
              )}

              <datalist id="db-teams-list">
                {leagueTeams.map(t => <option key={t} value={t} />)}
              </datalist>
              <datalist id="db-referees-list">
                {leagueReferees.map(r => <option key={r} value={r} />)}
              </datalist>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 12px', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <h4 style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Statistiche Partita</h4>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowManual(!showManual)}>
                  {showManual ? 'Nascondi Campi Manuali' : '✏️ Compila Manualmente'}
                </button>
              </div>
              
              {showManual && (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '8px 16px', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}></div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>CASA</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>OSPITE</div>

                  {[
                    ['Gol', 'home_goals', 'away_goals'],
                    ['Tiri', 'home_shots', 'away_shots'],
                    ['TIP', 'home_sot', 'away_sot'],
                    ['Falli', 'home_fouls', 'away_fouls'],
                    ['Corner', 'home_corners', 'away_corners'],
                    ['Gialli', 'home_yellows', 'away_yellows'],
                    ['Rossi', 'home_reds', 'away_reds'],
                    ['Parate', 'home_saves', 'away_saves'],
                  ].map(([label, homeField, awayField]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</div>
                      <input type="number" min="0" value={form[homeField]} onChange={e => handleFormChange(homeField, e.target.value)} required={label !== 'Parate'} style={{ textAlign: 'center' }} />
                      <input type="number" min="0" value={form[awayField]} onChange={e => handleFormChange(awayField, e.target.value)} required={label !== 'Parate'} style={{ textAlign: 'center' }} />
                    </div>
                  ))}
                </div>
              )}

              <div className="form-row" style={{ marginTop: 16 }}>
                <div className="input-group">
                  <label>Arbitro</label>
                  <input type="text" list="db-referees-list" value={form.referee} onChange={e => handleFormChange('referee', e.target.value)} placeholder="es. Massa" />
                </div>
                {form.league === 'SerieA' && (
                  <div className="input-group">
                    <label>Giornata</label>
                    <input type="number" value={form.matchday} onChange={e => handleFormChange('matchday', e.target.value)} />
                  </div>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-success btn-lg" style={{ flex: 1 }}>
                  {editMatchId ? '💾 Conferma Modifica' : '💾 Salva + Prossima'}
                </button>
              </div>
            </form>
          </div>
          </>
        )}

        {/* View DB */}
        {viewMode === 'view' && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <select value={league} onChange={e => setLeague(e.target.value)} style={{ width: 200, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  {LEAGUES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {matches.length} partite (ultime 50 per preview)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={handleExportDB} disabled={loading}>📥 Export DB</button>
                <button className="btn btn-primary btn-sm" onClick={handleExportBacktest} disabled={loading}>📥 Export Backtest</button>
              </div>
            </div>
            <div className="table-container" style={{ maxHeight: '70vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Data</th><th>Casa</th><th>Ospite</th><th>Gol</th>
                    <th>Tiri</th><th>TIP</th><th>Falli</th><th>Corner</th>
                    <th>Gialli</th><th>Rossi</th><th>Arbitro</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(m => (
                    <tr key={m.id}>
                      <td>{m.date}</td>
                      <td style={{ fontWeight: 600 }}>{m.home_team}</td>
                      <td style={{ fontWeight: 600 }}>{m.away_team}</td>
                      <td>{m.home_goals}-{m.away_goals}</td>
                      <td>{m.home_shots}-{m.away_shots}</td>
                      <td>{m.home_sot}-{m.away_sot}</td>
                      <td>{m.home_fouls}-{m.away_fouls}</td>
                      <td>{m.home_corners}-{m.away_corners}</td>
                      <td>{m.home_yellows}-{m.away_yellows}</td>
                      <td>{m.home_reds}-{m.away_reds}</td>
                      <td style={{ fontSize: 12 }}>{m.referee || '—'}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(m)}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id)}>✖</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Import */}
        {viewMode === 'import' && (
          <div className="card">
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>📥 Import da Resoconto.xlsx</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              Carica il tuo file Resoconto.xlsx per importare tutti i dati dei 5 campionati.
              I dati duplicati verranno ignorati automaticamente.
            </p>
            <input type="file" accept=".xlsx,.xls" onChange={handleImport} disabled={importing} style={{ marginBottom: 16 }} />
            {importing && (
              <div className="loading-container">
                <span className="loading-spinner" /> Import in corso...
              </div>
            )}
            {importResult && importResult.results && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Risultati Import:</h4>
                {Object.entries(importResult.results).map(([sheet, result]) => (
                  <div key={sheet} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{sheet}</span>
                    <span className={result.status === 'ok' ? 'badge badge-value' : 'badge badge-discard'}>
                      {result.status === 'ok' ? `${result.imported} partite` : 'Non trovato'}
                    </span>
                  </div>
                ))}
                {importResult.retrainTriggered && (
                  <div style={{ marginTop: 12, padding: 10, background: 'rgba(99,102,241,0.1)', borderRadius: 8, fontSize: 13, color: 'var(--accent-primary)' }}>
                    🤖 Re-training dei modelli ML avviato automaticamente in background.
                  </div>
                )}
              </div>
            )}

            {/* Pulsante Riallena Modelli ML */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>🤖 Riallena Modelli Machine Learning</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                Forza il re-training manuale dei 14 modelli ML (7 statistiche × Casa/Ospite) usando tutti i dati presenti nel database.
                Utile dopo ogni aggiornamento del DB. Dura circa 30 secondi.
              </p>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleRetrain}
                disabled={retraining}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {retraining ? <><span className="loading-spinner" /> Re-training in corso...</> : '🔄 Riallena Modelli ML'}
              </button>
            </div>
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>{toast.message}</div>}
      </main>
    </div>
  );
}
