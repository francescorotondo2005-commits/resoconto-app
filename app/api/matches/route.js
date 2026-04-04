import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from '@/lib/engine';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO } from '@/lib/probability';
import { getAllMarkets, getCategory, generateCustomMarket } from '@/lib/markets';
import { gradeBet } from '@/lib/grading';

// GET - Fetch matches (with optional league filter)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const league = searchParams.get('league');
    const limit = parseInt(searchParams.get('limit') || '1000');

    const db = await getDb();
    let matches;

    if (league) {
      const matchesRes = await db.execute({
        sql: 'SELECT * FROM matches WHERE league = ? ORDER BY date DESC LIMIT ?',
        args: [league, limit]
      });
      matches = matchesRes.rows;
    } else {
      const matchesRes = await db.execute({
        sql: 'SELECT * FROM matches ORDER BY date DESC LIMIT ?',
        args: [limit]
      });
      matches = matchesRes.rows;
    }

    // Get teams list
    const teamsRes = await db.execute(
      'SELECT DISTINCT league, name FROM teams ORDER BY league, name'
    );
    const teams = teamsRes.rows;

    // Get referees
    const refereesRes = await db.execute(
      `SELECT DISTINCT referee, league FROM matches 
       WHERE referee IS NOT NULL AND referee != '' 
       ORDER BY league, referee`
    );
    const referees = refereesRes.rows;

    return NextResponse.json({ matches, teams, referees });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Add a new match
export async function POST(request) {
  try {
    const match = await request.json();
    const db = await getDb();

    const stmt = await db.execute({
      sql: `
        INSERT INTO matches (league, matchday, date, home_team, away_team,
          home_goals, away_goals, home_shots, away_shots, home_sot, away_sot,
          home_fouls, away_fouls, home_corners, away_corners,
          home_yellows, away_yellows, home_reds, away_reds,
          home_saves, away_saves, referee)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        match.league, match.matchday || null, match.date,
        match.home_team, match.away_team,
        match.home_goals, match.away_goals,
        match.home_shots, match.away_shots,
        match.home_sot, match.away_sot,
        match.home_fouls, match.away_fouls,
        match.home_corners, match.away_corners,
        match.home_yellows, match.away_yellows,
        match.home_reds, match.away_reds,
        match.home_saves || null, match.away_saves || null,
        match.referee || null
      ]
    });

    // Auto-add teams
    await db.execute({ sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)', args: [match.league, match.home_team] });
    await db.execute({ sql: 'INSERT OR IGNORE INTO teams (league, name) VALUES (?, ?)', args: [match.league, match.away_team] });

    // ============================================
    // BACKTESTING & AUTO-GRADING
    // ============================================
    const matchKey = `${match.league}|${match.home_team}|${match.away_team}`;
    const descKey = `${match.home_team} - ${match.away_team}`;
    
    // 1. Snapshot Pre-Match per Backtesting (usando i match *esistenti* prima di questo!)
    try {
      const matchOddsRes = await db.execute({ sql: 'SELECT * FROM match_odds WHERE match_key = ?', args: [matchKey] });
      const matchOdds = matchOddsRes.rows;
      
      if (matchOdds.length > 0) {
        // Estrai stats pre-match (NON include la partita corrente perché non influisce)
        const pastMatchesRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ? AND id != ?', args: [match.league, Number(stmt.lastInsertRowid)] });
        const pastMatches = pastMatchesRes.rows;
        const statsKeys = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate'];
        const evsd = {};
        for (const stat of statsKeys) {
          evsd[stat] = {
            casa: { ev: EV_AVANZATO(match.home_team, match.away_team, stat, 'casa', pastMatches), sd: SD_AVANZATO(match.home_team, match.away_team, stat, 'casa', pastMatches) },
            ospite: { ev: EV_AVANZATO(match.home_team, match.away_team, stat, 'ospite', pastMatches), sd: SD_AVANZATO(match.home_team, match.away_team, stat, 'ospite', pastMatches) },
          };
          evsd[stat].totale = {
            ev: evsd[stat].casa.ev + evsd[stat].ospite.ev,
            sd: Math.sqrt(Math.pow(evsd[stat].casa.sd, 2) + Math.pow(evsd[stat].ospite.sd, 2)),
          };
        }

        // Genera tutti probabilità pre-match
        const allMarkets = getAllMarkets();
        for (const row of matchOdds.filter(r => r.is_custom === 1)) {
          allMarkets.push(generateCustomMarket(row.custom_stat, row.custom_type, row.custom_scope, row.custom_direction, row.custom_line, row.custom_esito));
        }

        const insertBacktestSql = `
          INSERT INTO backtest_bets (match_key, match_date, bet_name, bet_category, probability, sportium, sportbet, best_edge, outcome)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const market of allMarkets) {
          // Calcola probabilita
          let ev, sd, probability;
          if (market.type === 'over_under') {
            ev = evsd[market.stat][market.scope].ev;
            sd = evsd[market.stat][market.scope].sd;
            probability = PROB_BINOM_NEG(market.line, ev, sd, market.direction);
          } else if (market.type === '1x2') {
            const evCasa = evsd[market.stat].casa.ev; const sdCasa = evsd[market.stat].casa.sd;
            const evOspite = evsd[market.stat].ospite.ev; const sdOspite = evsd[market.stat].ospite.sd;
            probability = PROB_1X2_IBRIDO(evCasa, sdCasa, evOspite, sdOspite, market.esito);
          }

          if (!probability) continue;

          // Cerca se avevamo inserito quote (cerchiamo per name esatto o la custom definition se ha il formato custom)
          const oddRow = matchOdds.find(r => r.market_name === market.name || (r.is_custom === 1 && market.isCustom && r.custom_stat === market.stat && r.custom_type === market.type && r.custom_direction === market.direction && r.custom_line === market.line));
          
          if (oddRow && (oddRow.sportium || oddRow.sportbet)) {
            const getEdge = (prob, q) => q ? (prob * q) - 1 : null;
            const edgeSp = getEdge(probability, oddRow.sportium);
            const edgeSb = getEdge(probability, oddRow.sportbet);
            const bestEdge = Math.max(edgeSp || -999, edgeSb || -999);

            if (bestEdge > 0) { // VALUE BET TROVATA
              const out = gradeBet(market.name, match);
              await db.execute({
                sql: insertBacktestSql,
                args: [matchKey, match.date, market.name, getCategory(market.stat), probability, oddRow.sportium || null, oddRow.sportbet || null, bestEdge, out]
              });
            }
          }
        }

        // Elimina le quote pre-partita originali per pulizia
        await db.execute({ sql: 'DELETE FROM match_odds WHERE match_key = ?', args: [matchKey] });
      }
      
      // Indipendentemente dalle quote, se la partita è completata, rimuovila dal carrello pending_matches
      await db.execute({ sql: 'DELETE FROM pending_matches WHERE match_key = ?', args: [matchKey] });
    } catch (e) {
      console.error('Error during auto-backtesting', e);
    }

    // 2. Grada tutte le scommesse (singole e MULTIPLE) associate a questo match
    try {
      await evaluateBetsRelatedToMatch(db, descKey);
    } catch (e) {
      console.error('Error grading pending bets', e);
    }

    return NextResponse.json({ id: Number(stmt.lastInsertRowid), success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a match
export async function DELETE(request) {
  try {
    const { id } = await request.json();
    const db = await getDb();
    
    // Auto-clean: Se elimino la partita, potrei voler pulire anche il backtest generato per quella partita
    const matchRes = await db.execute({ sql: 'SELECT league, home_team, away_team FROM matches WHERE id = ?', args: [id] });
    const match = matchRes.rows[0];
    if (match) {
      const matchKey = `${match.league}|${match.home_team}|${match.away_team}`;
      await db.execute({ sql: 'DELETE FROM backtest_bets WHERE match_key = ?', args: [matchKey] });
    }
    
    await db.execute({ sql: 'DELETE FROM matches WHERE id = ?', args: [id] });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update match statistics and auto-regrade anything associated
export async function PATCH(request) {
  try {
    const match = await request.json();
    if (!match.id) throw new Error('ID partita mancante');
    const db = await getDb();

    // Aggiorna metriche
    await db.execute({
      sql: `
        UPDATE matches SET
          home_team = ?, away_team = ?, date = ?, matchday = ?, referee = ?,
          home_goals = ?, away_goals = ?, home_shots = ?, away_shots = ?, home_sot = ?, away_sot = ?,
          home_fouls = ?, away_fouls = ?, home_corners = ?, away_corners = ?,
          home_yellows = ?, away_yellows = ?, home_reds = ?, away_reds = ?,
          home_saves = ?, away_saves = ?
        WHERE id = ?
      `,
      args: [
        match.home_team, match.away_team, match.date, match.matchday || null, match.referee || null,
        match.home_goals, match.away_goals, match.home_shots, match.away_shots, match.home_sot, match.away_sot,
        match.home_fouls, match.away_fouls, match.home_corners, match.away_corners,
        match.home_yellows, match.away_yellows, match.home_reds, match.away_reds,
        match.home_saves || null, match.away_saves || null,
        match.id
      ]
    });

    const matchKey = `${match.league}|${match.home_team}|${match.away_team}`;
    const descKey = `${match.home_team} - ${match.away_team}`;

    // Ricalcola il Backtest se presente (il record backtest_bets rimane intatto, cambia solo esito)
    try {
      const backtestRes = await db.execute({ sql: 'SELECT * FROM backtest_bets WHERE match_key = ?', args: [matchKey] });
      for (const b of backtestRes.rows) {
        const out = gradeBet(b.bet_name, match);
        await db.execute({ sql: 'UPDATE backtest_bets SET outcome = ? WHERE id = ?', args: [out, b.id] });
      }
    } catch (e) {
      console.error('Error regrading backtest_bets on PATCH', e);
    }

    // Ricalcola i pending bets / scommesse classiche e MULTIPLE associate a questa partita
    try {
      await evaluateBetsRelatedToMatch(db, descKey);
    } catch (e) {
      console.error('Error regrading bets on PATCH', e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- HELPER DI REFERTAZIONE GLOBALE (SINGOLE E MULTIPLE) ---
async function evaluateBetsRelatedToMatch(db, descKey) {
  // Trova tutte le scommesse che includono questo match, sia se sono singole, sia se sono porzioni di una multipla
  const betsRes = await db.execute({ 
    sql: `SELECT * FROM bets WHERE match_description = ? OR match_description LIKE ? OR match_description LIKE ? OR match_description LIKE ?`, 
    args: [descKey, `${descKey} + %`, `% + ${descKey} + %`, `% + ${descKey}`] 
  });

  for (const b of betsRes.rows) {
    if (b.match_description.includes(' + ')) {
      // MULTIPLA
      const matchDescs = b.match_description.split(' + ');
      const legNames = b.bet_name.split(' + ');
      
      let allWin = true;
      let anyPending = false;
      let anyVoid = false;

      for (let i = 0; i < matchDescs.length; i++) {
         const legDesc = matchDescs[i].trim();
         const [h, a] = legDesc.split(' - ');
         // Trova il match nel DB
         const legMatchRes = await db.execute({
            sql: 'SELECT * FROM matches WHERE home_team = ? AND away_team = ? ORDER BY date DESC LIMIT 1',
            args: [h.trim(), a.trim()]
         });
         
         if (legMatchRes.rows.length === 0) {
            anyPending = true;
         } else {
            const legStat = legMatchRes.rows[0];
            const res = gradeBet(legNames[i].trim(), legStat);
            if (res === 'LOSS') {
               allWin = false;
               break; // Multipla persa, non c'è bisogno di guardare le altre!
            }
            if (res === 'PENDING') anyPending = true;
            if (res === 'VOID') anyVoid = true;
         }
      }
      
      let finalOut = 'PENDING';
      if (!allWin) finalOut = 'LOSS';
      else if (anyPending) finalOut = 'PENDING';
      else if (anyVoid) finalOut = 'VOID';
      else finalOut = 'WIN';

      let profit = null;
      if (finalOut === 'WIN') profit = (b.stake * b.actual_odds) - b.stake;
      else if (finalOut === 'LOSS') profit = -b.stake;
      
      await db.execute({ sql: 'UPDATE bets SET outcome = ?, profit = ? WHERE id = ?', args: [finalOut, profit, b.id] });

    } else {
      // SINGOLA
      const [h, a] = b.match_description.split(' - ');
      const legMatchRes = await db.execute({
          sql: 'SELECT * FROM matches WHERE home_team = ? AND away_team = ? ORDER BY date DESC LIMIT 1',
          args: [h.trim(), a.trim()]
      });
      if (legMatchRes.rows.length > 0) {
         const matchInfo = legMatchRes.rows[0];
         const out = gradeBet(b.bet_name, matchInfo);
         
         let profit = null;
         if (out === 'WIN') profit = (b.stake * b.actual_odds) - b.stake;
         else if (out === 'LOSS') profit = -b.stake;
         
         await db.execute({ sql: 'UPDATE bets SET outcome = ?, profit = ? WHERE id = ?', args: [out, profit, b.id] });
      }
    }
  }
}
