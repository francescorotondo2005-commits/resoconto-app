import { NextResponse } from 'next/server';
import { getDb, getSetting } from '@/lib/db';
import { EV_AVANZATO, SD_AVANZATO, CV_CALC } from '@/lib/engine';
import { PROB_BINOM_NEG, PROB_1X2_IBRIDO } from '@/lib/probability';
import { INDICE_ARBITRO_AVANZATO } from '@/lib/referee';
import { getAllMarkets, getCategory, generateCustomMarket } from '@/lib/markets';

export async function POST(request) {
  try {
    const { league, homeTeam, awayTeam, referee } = await request.json();

    if (!league || !homeTeam || !awayTeam) {
      return NextResponse.json({ error: 'Campi obbligatori mancanti' }, { status: 400 });
    }

    const db = await getDb();
    const matchesRes = await db.execute({ sql: 'SELECT * FROM matches WHERE league = ?', args: [league] });
    const matches = matchesRes.rows;

    if (matches.length === 0) {
      return NextResponse.json({ error: 'Nessun dato nel database per questo campionato' }, { status: 404 });
    }

    const minProb = parseFloat(await getSetting('min_probability') || '0.65');
    const minEdge = parseFloat(await getSetting('min_edge') || '0.20');

    // Calcola EV e SD per ogni statistica
    const stats = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate'];
    const evsd = {};

    for (const stat of stats) {
      evsd[stat] = {
        casa: {
          ev: EV_AVANZATO(homeTeam, awayTeam, stat, 'casa', matches),
          sd: SD_AVANZATO(homeTeam, awayTeam, stat, 'casa', matches),
        },
        ospite: {
          ev: EV_AVANZATO(homeTeam, awayTeam, stat, 'ospite', matches),
          sd: SD_AVANZATO(homeTeam, awayTeam, stat, 'ospite', matches),
        },
      };
      evsd[stat].casa.cv = CV_CALC(evsd[stat].casa.ev, evsd[stat].casa.sd);
      evsd[stat].ospite.cv = CV_CALC(evsd[stat].ospite.ev, evsd[stat].ospite.sd);
      evsd[stat].totale = {
        ev: evsd[stat].casa.ev + evsd[stat].ospite.ev,
        sd: Math.sqrt(Math.pow(evsd[stat].casa.sd, 2) + Math.pow(evsd[stat].ospite.sd, 2)),
      };
      evsd[stat].totale.cv = CV_CALC(evsd[stat].totale.ev, evsd[stat].totale.sd);
    }

    // Rating arbitro
    let refereeRating = { falli: 1, cartellini: 1 };
    if (referee) {
      refereeRating.falli = INDICE_ARBITRO_AVANZATO(referee, 'falli', matches);
      refereeRating.cartellini = INDICE_ARBITRO_AVANZATO(referee, 'cartellini', matches);

      // Applica il moltiplicatore ai valori EV e SD per le statistiche influenzate
      const applyRating = (statKey, rating) => {
        if (!evsd[statKey]) return;
        evsd[statKey].casa.ev *= rating;
        evsd[statKey].casa.sd *= rating;
        evsd[statKey].ospite.ev *= rating;
        evsd[statKey].ospite.sd *= rating;
        evsd[statKey].totale.ev *= rating;
        evsd[statKey].totale.sd *= rating;
        // Il CV (sd/ev) rimane matematicamente invariato
      };

      applyRating('falli', refereeRating.falli);
      applyRating('cartellini', refereeRating.cartellini);
    }

    // Genera tutte le scommesse con probabilità
    const allMarkets = getAllMarkets();

    // Carica scommesse custom
    const matchKey = `${league}|${homeTeam}|${awayTeam}`;

    // Aggiorna tabella pending_matches per il "carrello" globale e per l'arbitro
    try {
      await db.execute({
        sql: `INSERT INTO pending_matches (match_key, league, home_team, away_team, referee, updated_at) 
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(match_key) DO UPDATE SET 
              referee = excluded.referee, 
              updated_at = CURRENT_TIMESTAMP`,
        args: [matchKey, league, homeTeam, awayTeam, referee || null]
      });
    } catch (e) {
      console.error('Error updating pending_matches:', e);
    }

    try {
      const customRowsRes = await db.execute({ sql: 'SELECT * FROM match_odds WHERE match_key = ? AND is_custom = 1', args: [matchKey] });
      const customRows = customRowsRes.rows;
      for (const row of customRows) {
        const customMkt = generateCustomMarket(
          row.custom_stat,
          row.custom_type,
          row.custom_scope,
          row.custom_direction,
          row.custom_line,
          row.custom_esito
        );
        customMkt.defaultOrder = allMarkets.length; // Appended at the end
        allMarkets.push(customMkt);
      }
    } catch (e) {
      console.error('Error loading custom markets:', e);
    }

    // Deduplicate markets (in case a custom market overrides/matches a default one)
    const uniqueMarkets = [];
    const seenMarkets = new Set();
    for (const mkt of allMarkets) {
      if (!seenMarkets.has(mkt.name)) {
        seenMarkets.add(mkt.name);
        uniqueMarkets.push(mkt);
      }
    }

    const results = [];

    for (const market of uniqueMarkets) {
      let ev, sd, cv, probability;

      if (market.type === 'over_under') {
        // Determine which EV/SD to use based on scope
        if (market.scope === 'casa') {
          ev = evsd[market.stat].casa.ev;
          sd = evsd[market.stat].casa.sd;
        } else if (market.scope === 'ospite') {
          ev = evsd[market.stat].ospite.ev;
          sd = evsd[market.stat].ospite.sd;
        } else {
          ev = evsd[market.stat].totale.ev;
          sd = evsd[market.stat].totale.sd;
        }

        cv = CV_CALC(ev, sd);
        probability = PROB_BINOM_NEG(market.line, ev, sd, market.direction);

      } else if (market.type === '1x2') {
        const evCasa = evsd[market.stat].casa.ev;
        const sdCasa = evsd[market.stat].casa.sd;
        const evOspite = evsd[market.stat].ospite.ev;
        const sdOspite = evsd[market.stat].ospite.sd;

        ev = market.esito === '1' ? evCasa : market.esito === '2' ? evOspite : (evCasa + evOspite) / 2;
        sd = market.esito === '1' ? sdCasa : market.esito === '2' ? sdOspite : Math.sqrt((sdCasa ** 2 + sdOspite ** 2) / 2);
        cv = CV_CALC(ev, sd);
        probability = PROB_1X2_IBRIDO(evCasa, sdCasa, evOspite, sdOspite, market.esito);
      }

      const fairOdds = probability > 0 ? 1 / probability : 999;
      const minOdds = probability >= minProb ? (1 + minEdge) / probability : null;
      const isDiscarded = probability < minProb;

      results.push({
        name: market.name,
        category: getCategory(market.stat),
        type: market.type,
        ev: Math.round(ev * 100) / 100,
        sd: Math.round(sd * 100) / 100,
        cv: Math.round(cv * 100) / 100,
        probability: Math.round(probability * 10000) / 10000,
        fairOdds: Math.round(fairOdds * 100) / 100,
        minOdds: minOdds ? Math.round(minOdds * 100) / 100 : null,
        isDiscarded,
        defaultOrder: market.defaultOrder,
        isCustom: market.isCustom || false,
      });
    }

    return NextResponse.json({
      evsd,
      refereeRating,
      markets: results,
      settings: { minProb, minEdge },
      matchInfo: { league, homeTeam, awayTeam, referee },
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
