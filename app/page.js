'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Link from 'next/link';

const LEAGUE_NAMES = {
  SerieA: 'Serie A',
  Premier: 'Premier League',
  LaLiga: 'La Liga',
  Ligue1: 'Ligue 1',
  Bundes: 'Bundesliga',
};

const LEAGUE_COLORS = {
  SerieA: '#00b894',
  Premier: '#6c5ce7',
  LaLiga: '#fdcb6e',
  Ligue1: '#74b9ff',
  Bundes: '#ff6b6b',
};

export default function Dashboard() {
  const [fixtures, setFixtures] = useState([]);
  const [stats, setStats] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [fixturesRes, betsRes, settingsRes] = await Promise.all([
        fetch('/api/fixtures'),
        fetch('/api/bets'),
        fetch('/api/settings'),
      ]);
      
      const fixturesData = await fixturesRes.json();
      const betsData = await betsRes.json();
      const settingsData = await settingsRes.json();

      setFixtures(fixturesData.fixtures || []);
      setStats(betsData.stats || {});
      setDbStats(settingsData.db_stats || {});
    } catch (e) {
      console.error('Error loading dashboard:', e);
    }
    setLoading(false);
  }

  async function refreshFixtures() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/fixtures?refresh=true');
      const data = await res.json();
      setFixtures(data.fixtures || []);
    } catch (e) {
      console.error('Error refreshing:', e);
    }
    setRefreshing(false);
  }

  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{today}</p>
        </div>

        {/* Stats Row */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Bet Piazzate</div>
            <div className="stat-value">{stats?.total || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Hit Rate</div>
            <div className="stat-value">
              {stats?.hitRate ? `${(stats.hitRate * 100).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">P&L Totale</div>
            <div className={`stat-value ${(stats?.totalProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
              {stats?.totalProfit ? `€${stats.totalProfit.toFixed(2)}` : '€0.00'}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Partite nel DB</div>
            <div className="stat-value">{dbStats?.totalMatches || 0}</div>
          </div>
        </div>

        {/* Fixtures */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>⚽ Partite di Oggi</h2>
          <button className="btn btn-secondary btn-sm" onClick={refreshFixtures} disabled={refreshing}>
            {refreshing ? <span className="loading-spinner" /> : '🔄'} Aggiorna Palinsesto
          </button>
        </div>

        {loading ? (
          <div className="loading-container">
            <span className="loading-spinner" /> Caricamento...
          </div>
        ) : fixtures.length === 0 ? (
          <div className="empty-state">
            <h3>Nessuna partita trovata per oggi</h3>
            <p>Premi "Aggiorna Palinsesto" per caricare le partite, oppure vai in Impostazioni per configurare la API Key.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fixtures.map((f, i) => (
              <Link key={i} href={`/analysis?league=${f.league}&home=${encodeURIComponent(f.home_team)}&away=${encodeURIComponent(f.away_team)}`} style={{ textDecoration: 'none' }}>
                <div className="fixture-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span className="fixture-league-badge" style={{ borderColor: LEAGUE_COLORS[f.league] + '40', background: LEAGUE_COLORS[f.league] + '15', color: LEAGUE_COLORS[f.league] }}>
                      {LEAGUE_NAMES[f.league] || f.league}
                    </span>
                    <div className="fixture-teams">
                      <span>{f.home_team}</span>
                      <span className="fixture-vs">vs</span>
                      <span>{f.away_team}</span>
                    </div>
                  </div>
                  <span className="fixture-time">
                    {f.kick_off ? new Date(f.kick_off).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* DB Overview */}
        {dbStats && dbStats.byLeague && dbStats.byLeague.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>📊 Database</h2>
            <div className="grid-5">
              {dbStats.byLeague.map((l) => (
                <div key={l.league} className="card" style={{ borderLeft: `3px solid ${LEAGUE_COLORS[l.league] || '#6c5ce7'}` }}>
                  <div className="card-title">{LEAGUE_NAMES[l.league] || l.league}</div>
                  <div className="card-value">{l.count}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>partite</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
