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
  const [viewMode, setViewMode] = useState('add'); // 'add' | 'view' | 'import'

  const [teams, setTeams] = useState([]);
  const [referees, setReferees] = useState([]);

  useEffect(() => { 
    loadMatches(); 
  }, [league]);

  useEffect(() => { 
    loadTeams(); 
  }, []);

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
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          home_goals: Number(form.home_goals), away_goals: Number(form.away_goals),
          home_shots: Number(form.home_shots), away_shots: Number(form.away_shots),
          home_sot: Number(form.home_sot), away_sot: Number(form.away_sot),
          home_fouls: Number(form.home_fouls), away_fouls: Number(form.away_fouls),
          home_corners: Number(form.home_corners), away_corners: Number(form.away_corners),
          home_yellows: Number(form.home_yellows), away_yellows: Number(form.away_yellows),
          home_reds: Number(form.home_reds), away_reds: Number(form.away_reds),
          home_saves: form.home_saves ? Number(form.home_saves) : null,
          away_saves: form.away_saves ? Number(form.away_saves) : null,
        }),
      });

      if (res.ok) {
        setToast({ type: 'success', message: `✅ ${form.home_team} vs ${form.away_team} salvata!` });
        setForm({ ...EMPTY_MATCH, league: form.league, date: form.date });
        loadMatches();
        setTimeout(() => setToast(null), 3000);
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
    if (!confirm('Eliminare questa partita?')) return;
    try {
      await fetch('/api/matches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadMatches();
    } catch (e) { console.error(e); }
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
          <div className="card">
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Inserimento Rapido</h3>
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

              <datalist id="db-teams-list">
                {leagueTeams.map(t => <option key={t} value={t} />)}
              </datalist>
              <datalist id="db-referees-list">
                {leagueReferees.map(r => <option key={r} value={r} />)}
              </datalist>

              <h4 style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '16px 0 12px', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Statistiche Partita</h4>
              
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
                <button type="submit" className="btn btn-success btn-lg" style={{ flex: 1 }}>💾 Salva + Prossima</button>
              </div>
            </form>
          </div>
        )}

        {/* View DB */}
        {viewMode === 'view' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <select value={league} onChange={e => setLeague(e.target.value)} style={{ width: 200 }}>
                {LEAGUES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                {matches.length} partite (ultime 50)
              </span>
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
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id)}>✕</button>
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
              </div>
            )}
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>{toast.message}</div>}
      </main>
    </div>
  );
}
