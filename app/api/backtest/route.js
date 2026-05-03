import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { calcHistorySummary, calcFormSummary } from '@/lib/history';

/**
 * Arricchisce una scommessa con storico e forma calcolati al volo.
 * matchesBefore = partite del campionato con date < match_date della bet.
 */
function enrichBetWithHistory(bet, matchesBefore, referee) {
  try {
    const hist = calcHistorySummary(
      bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore
    );
    const form = calcFormSummary(
      bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore, 5
    );

    return {
      ...bet,
      hist_score:       hist?.histScore ?? null,
      home_hist_pct:    hist?.homePct ?? null,
      home_hist_sample: hist?.homeSample ?? null,
      away_hist_pct:    hist?.awayPct ?? null,
      away_hist_sample: hist?.awaySample ?? null,
      ref_hist_pct:     hist?.refPct ?? null,
      ref_hist_sample:  hist?.refSample ?? null,
      form_home_pct:    form?.homeFormPct ?? null,
      form_home_n:      form?.homeN ?? null,
      form_away_pct:    form?.awayFormPct ?? null,
      form_away_n:      form?.awayN ?? null,
      form_ref_pct:     form?.refFormPct ?? null,
      form_ref_n:       form?.refN ?? null,
    };
  } catch (e) {
    console.error('enrichBetWithHistory error:', e);
    return bet;
  }
}

// GET - Fetch backtest bets (+ storico live se non già salvato)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '1000');
    
    const db = await getDb();
    const res = await db.execute({ sql: 'SELECT * FROM backtest_bets ORDER BY created_at DESC LIMIT ?', args: [limit] });
    const rawBets = res.rows;

    // Raggruppa per campionato per fare UNA sola query per lega
    const byLeague = {};
    for (const b of rawBets) {
      const [league, homeTeam, awayTeam] = b.match_key.split('|');
      if (!byLeague[league]) byLeague[league] = { matches: null, bets: [] };
      byLeague[league].bets.push({ ...b, _homeTeam: homeTeam, _awayTeam: awayTeam });
    }

    // Carica tutte le partite di ogni lega UNA sola volta
    for (const league of Object.keys(byLeague)) {
      const mRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ? ORDER BY date ASC', args: [league] });
      byLeague[league].matches = mRes.rows;
    }

    // Arricchisci le bet con storico (solo se hist_score non già salvato in DB)
    const backtestBets = [];
    for (const league of Object.keys(byLeague)) {
      const { matches, bets } = byLeague[league];

      for (const bet of bets) {
        // Se già calcolato in DB, usa quello (più veloce)
        if (bet.hist_score !== null && bet.hist_score !== undefined) {
          // Rimuovi campi interni
          const { _homeTeam, _awayTeam, ...clean } = bet;
          backtestBets.push(clean);
          continue;
        }

        // Altrimenti calcola live
        const matchesBefore = matches.filter(m => m.date < bet.match_date);

        // Recupera arbitro da pending_matches se esiste
        let referee = null;
        try {
          const pmRes = await db.execute({
            sql: 'SELECT referee FROM pending_matches WHERE match_key = ?',
            args: [bet.match_key]
          });
          referee = pmRes.rows[0]?.referee || null;
        } catch { /* ignora */ }

        // Se non trovato in pending, cerca nella tabella matches (partita già conclusa)
        if (!referee) {
          const matchInDb = matches.find(m => m.home_team === bet._homeTeam && m.away_team === bet._awayTeam && m.date >= bet.match_date && m.date <= bet.match_date + 'z'); // Approssimazione
          if (!matchInDb) {
            // Cerchiamo solo per squadre, visto che si gioca una volta in casa a stagione
            const matchByTeam = matches.find(m => m.home_team === bet._homeTeam && m.away_team === bet._awayTeam);
            if (matchByTeam) referee = matchByTeam.referee;
          } else {
            referee = matchInDb.referee;
          }
        }

        const enriched = enrichBetWithHistory(bet, matchesBefore, referee);
        const { _homeTeam, _awayTeam, ...clean } = enriched;
        backtestBets.push(clean);
      }
    }

    // Ordina per created_at DESC (stesso ordine originale)
    backtestBets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Aggregation Stats for Backtest
    const completed = backtestBets.filter(b => b.outcome !== 'PENDING' && b.outcome !== 'VOID');
    const wins = completed.filter(b => b.outcome === 'WIN').length;
    const losses = completed.filter(b => b.outcome === 'LOSS').length;
    const total = completed.length;
    
    let theoreticalProfit = 0;
    const byCategory = {};

    for (const b of completed) {
      const bestOdds = Math.max(b.sportium || -1, b.sportbet || -1);
      let profit = 0;
      if (b.outcome === 'WIN') profit = bestOdds - 1;
      else if (b.outcome === 'LOSS') profit = -1;
      theoreticalProfit += profit;

      if (!byCategory[b.bet_category]) {
        byCategory[b.bet_category] = { wins: 0, total: 0, profit: 0 };
      }
      byCategory[b.bet_category].total++;
      if (b.outcome === 'WIN') byCategory[b.bet_category].wins++;
      byCategory[b.bet_category].profit += profit;
    }

    const hitRate = total > 0 ? wins / total : 0;
    const yieldPercentage = total > 0 ? (theoreticalProfit / total) : 0;
    const avgEdge = total > 0 ? completed.reduce((s, b) => s + b.best_edge, 0) / total : 0;

    const stats = { total, wins, losses, hitRate, theoreticalProfit, yieldPercentage, avgEdge, byCategory };

    return NextResponse.json({ backtestBets, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a backtest bet
export async function DELETE(request) {
  try {
    const { id } = await request.json();
    const db = await getDb();
    await db.execute({ sql: 'DELETE FROM backtest_bets WHERE id = ?', args: [id] });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Backfill storico per tutte le bet esistenti senza hist_score
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'backfill') {
      return NextResponse.json({ error: 'Azione non valida' }, { status: 400 });
    }

    const db = await getDb();

    // Prendi tutte le bet (rimuovo WHERE hist_score IS NULL per forzare il ricalcolo con gli arbitri giusti)
    const res = await db.execute({
      sql: 'SELECT * FROM backtest_bets ORDER BY match_date ASC',
      args: []
    });
    const bets = res.rows;

    if (bets.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: 'Nessuna bet da aggiornare.' });
    }

    // Raggruppa per lega
    const byLeague = {};
    for (const b of bets) {
      const [league, homeTeam, awayTeam] = b.match_key.split('|');
      if (!byLeague[league]) byLeague[league] = { matches: null, bets: [] };
      byLeague[league].bets.push({ ...b, _homeTeam: homeTeam, _awayTeam: awayTeam });
    }

    for (const league of Object.keys(byLeague)) {
      const mRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ? ORDER BY date ASC', args: [league] });
      byLeague[league].matches = mRes.rows;
    }

    // Carica tutti gli arbitri da pending_matches
    const pmRes = await db.execute('SELECT match_key, referee FROM pending_matches');
    const refereeMap = {};
    for (const r of pmRes.rows) refereeMap[r.match_key] = r.referee;

    let updated = 0;
    const stmts = [];

    for (const league of Object.keys(byLeague)) {
      const { matches, bets: leagueBets } = byLeague[league];

      for (const bet of leagueBets) {
        const matchesBefore = matches.filter(m => m.date < bet.match_date);
        
        let referee = refereeMap[bet.match_key] || null;
        if (!referee) {
          const m = matches.find(m => m.home_team === bet._homeTeam && m.away_team === bet._awayTeam);
          if (m) referee = m.referee;
        }

        const hist = calcHistorySummary(bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore);
        const form = calcFormSummary(bet._homeTeam, bet._awayTeam, referee, bet.bet_name, matchesBefore, 5);

        if (!hist) continue;

        stmts.push({
          sql: `UPDATE backtest_bets SET
            hist_score = ?, home_hist_pct = ?, home_hist_sample = ?,
            away_hist_pct = ?, away_hist_sample = ?,
            home_hist_overall_pct = ?, home_hist_overall_sample = ?,
            away_hist_overall_pct = ?, away_hist_overall_sample = ?,
            ref_hist_pct = ?, ref_hist_sample = ?,
            form_home_pct = ?, form_home_n = ?,
            form_away_pct = ?, form_away_n = ?,
            form_home_gen_pct = ?, form_home_gen_n = ?,
            form_away_gen_pct = ?, form_away_gen_n = ?,
            form_ref_pct = ?, form_ref_n = ?
          WHERE id = ?`,
          args: [
            hist.histScore, hist.homePct, hist.homeSample,
            hist.awayPct, hist.awaySample,
            hist.homePctOverall ?? null, hist.homeSampleOverall ?? null,
            hist.awayPctOverall ?? null, hist.awaySampleOverall ?? null,
            hist.refPct, hist.refSample,
            form?.homeFormPct ?? null, form?.homeN ?? null,
            form?.awayFormPct ?? null, form?.awayN ?? null,
            form?.homeGenFormPct ?? null, form?.homeGenN ?? null,
            form?.awayGenFormPct ?? null, form?.awayGenN ?? null,
            form?.refFormPct ?? null, form?.refN ?? null,
            bet.id
          ]
        });
        updated++;
      }
    }

    // Esegui in batch (massimo 50 alla volta per evitare timeout)
    const BATCH_SIZE = 50;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      await db.batch(stmts.slice(i, i + BATCH_SIZE));
    }

    return NextResponse.json({ success: true, updated, total: bets.length });
  } catch (error) {
    console.error('Backfill error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
