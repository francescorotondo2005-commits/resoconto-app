'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
      setApiKey(data.api_football_key || '');
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function saveSettings(updates) {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setToast({ type: 'success', message: '✅ Impostazioni salvate!' });
        loadSettings();
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  function handleChange(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1 className="page-title">⚙️ Impostazioni</h1>
          <p className="page-subtitle">Configura i parametri del sistema</p>
        </div>

        {loading ? (
          <div className="loading-container"><span className="loading-spinner" /> Caricamento...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
            {/* Analysis Parameters */}
            <div className="card">
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>📊 Parametri Analisi</h3>
              <div className="input-group">
                <label>Range Probabilità (%)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min="0" max="100" step="1"
                    style={{ flex: 1 }}
                    value={Math.round((settings.min_probability || 0.65) * 100)}
                    onChange={e => handleChange('min_probability', (parseFloat(e.target.value) / 100).toString())} />
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-muted)' }}>—</span>
                  <input type="number" min="0" max="100" step="1"
                    style={{ flex: 1 }}
                    value={Math.round((settings.max_probability || 0.85) * 100)}
                    onChange={e => handleChange('max_probability', (parseFloat(e.target.value) / 100).toString())} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Mostra solo le scommesse nel range di probabilità indicato
                </span>
              </div>
              <div className="input-group">
                <label>Minimum Edge (%)</label>
                <input type="number" min="0" max="100" step="1"
                  value={Math.round((settings.min_edge || 0.20) * 100)}
                  onChange={e => handleChange('min_edge', (parseFloat(e.target.value) / 100).toString())} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Margine minimo richiesto per calcolare la Quota Minima
                </span>
              </div>
              <button className="btn btn-primary" onClick={() => saveSettings({
                min_probability: settings.min_probability,
                min_edge: settings.min_edge,
                max_probability: settings.max_probability,
              })}>Salva Parametri</button>
            </div>

            {/* Bankroll & Staking */}
            <div className="card">
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💰 Bankroll & Staking</h3>
              <div className="input-group">
                <label>Bankroll Iniziale (€)</label>
                <input type="number" min="1" value={settings.bankroll || 100}
                  onChange={e => handleChange('bankroll', e.target.value)} />
              </div>
              <div className="input-group">
                <label>Modalità Stake</label>
                <select value={settings.stake_mode || 'flat'}
                  onChange={e => handleChange('stake_mode', e.target.value)}>
                  <option value="flat">Flat Stake (€ fisso)</option>
                  <option value="kelly">Kelly Criterion (¼ Kelly)</option>
                </select>
              </div>
              {(settings.stake_mode || 'flat') === 'flat' && (
                <div className="input-group">
                  <label>Stake Fisso (€)</label>
                  <input type="number" min="1" step="0.5" value={settings.flat_stake || 1}
                    onChange={e => handleChange('flat_stake', e.target.value)} />
                </div>
              )}
              <button className="btn btn-primary" onClick={() => saveSettings({
                bankroll: settings.bankroll,
                stake_mode: settings.stake_mode,
                flat_stake: settings.flat_stake,
              })}>Salva Staking</button>
            </div>

            {/* API Football */}
            <div className="card">
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>⚽ API-Football</h3>
              <div className="input-group">
                <label>API Key</label>
                <input type="password" value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="Inserisci la tua API Key..." />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {settings.api_football_configured
                    ? '✅ API Key configurata'
                    : '⚠️ API Key non configurata — il palinsesto non funzionerà'}
                </span>
              </div>
              <button className="btn btn-primary" onClick={() => saveSettings({ api_football_key: apiKey })}>
                Salva API Key
              </button>
            </div>

            {/* DB Stats */}
            {settings.db_stats && (
              <div className="card">
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>📊 Stato Database</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Partite Totali</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{settings.db_stats.totalMatches}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scommesse Tracciate</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{settings.db_stats.totalBets}</div>
                  </div>
                </div>
                {settings.db_stats.byLeague && (
                  <div style={{ marginTop: 16 }}>
                    {settings.db_stats.byLeague.map(l => (
                      <div key={l.league} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13 }}>{l.league}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{l.count} partite</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>{toast.message}</div>}
      </main>
    </div>
  );
}
