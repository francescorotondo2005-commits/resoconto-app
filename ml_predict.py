import sqlite3
import pandas as pd
import numpy as np
import joblib
import argparse
import json
import warnings
import sys
import os

os.environ["PYTHONWARNINGS"] = "ignore"
warnings.filterwarnings('ignore')

# Importa le funzioni condivise da ml_train_all
from ml_train_all import (
    STATS, ALL_STATS, SOFA_STATS, HIT_RATE_THRESHOLDS,
    get_stat, get_feature_cols,
    _avg, _hit_rate, _median, _std,
    MODELS_DIR, VARIANCE_MODELS_DIR
)


# ─────────────────────────────────────────────────────────────
# CALCOLO FEATURE PER LA PREDIZIONE
# ─────────────────────────────────────────────────────────────
def calculate_team_features(df, target_teams, target_refs):
    """
    Scorre l'intero DB e calcola le stesse feature avanzate usate in training.
    [PROPOSTA 1] Ora traccia ALL_STATS (incluse SOFA_STATS come xg, possession,
    shots_insidebox, big_chances, offsides) per ogni squadra.
    """
    team_hist = {t: {s: {'for_all': [], 'ag_all': [],
                          'home_for': [], 'home_ag': [],
                          'away_for': [], 'away_ag': []}
                     for s in ALL_STATS}
                 for t in target_teams}
    ref_hist  = {r: {s: [] for s in STATS} for r in target_refs if r}

    team_last_date = {}
    main_league_teams = set()
    h2h_hist = {}
    league_standings = {}

    for row in df.itertuples():
        h   = row.home_team
        a   = row.away_team
        ref = str(getattr(row, 'referee', '') or '')
        league = str(getattr(row, 'league', '') or '')

        comp_type = getattr(row, 'competition_type', 'league') or 'league'
        if comp_type == 'league' and league in ('SerieA', 'Premier', 'LaLiga', 'Ligue1', 'Bundes'):
            main_league_teams.add(h)
            main_league_teams.add(a)

        row_d = row._asdict()

        # Costante per skip placeholder
        ZERO_SKIP_STATS = {'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate',
                           'xg', 'possession', 'shots_insidebox', 'big_chances',
                           'offsides', 'passes', 'crosses', 'tackles', 'interceptions'}

        for s in ALL_STATS:
            hv    = get_stat(row_d, s, True)
            av    = get_stat(row_d, s, False)

            # Salta None (dati SofaScore mancanti per le partite più vecchie)
            if hv is None or av is None:
                continue

            # Salta placeholder cup match (entrambi 0 per stat non-gol)
            if s in ZERO_SKIP_STATS and hv == 0 and av == 0:
                continue

            if h in team_hist:
                team_hist[h][s]['for_all'].append(hv)
                team_hist[h][s]['ag_all'].append(av)
                team_hist[h][s]['home_for'].append(hv)
                team_hist[h][s]['home_ag'].append(av)
            if a in team_hist:
                team_hist[a][s]['for_all'].append(av)
                team_hist[a][s]['ag_all'].append(hv)
                team_hist[a][s]['away_for'].append(av)
                team_hist[a][s]['away_ag'].append(hv)

            # Arbitro: solo per STATS (non SOFA_STATS)
            if s in STATS and ref in ref_hist:
                ref_hist[ref][s].append(hv + av)

        # Update last match dates
        dt_val = pd.to_datetime(row.date)
        team_last_date[h] = dt_val
        team_last_date[a] = dt_val

        # Update H2H history
        h2h_key = tuple(sorted([h, a]))
        if h2h_key not in h2h_hist:
            h2h_hist[h2h_key] = []
        h2h_hist[h2h_key].append({
            'home': h,
            'away': a,
            'stats_home': {s: get_stat(row_d, s, True) for s in STATS},
            'stats_away': {s: get_stat(row_d, s, False) for s in STATS}
        })

        # Update standings
        if comp_type == 'league' and league in ('SerieA', 'Premier', 'LaLiga', 'Ligue1', 'Bundes'):
            if league not in league_standings:
                league_standings[league] = {}
            for t_item in (h, a):
                if t_item not in league_standings[league]:
                    league_standings[league][t_item] = {'points': 0, 'played': 0}
            league_standings[league][h]['played'] += 1
            league_standings[league][a]['played'] += 1
            h_g = get_stat(row_d, 'gol', True)
            a_g = get_stat(row_d, 'gol', False)
            if h_g > a_g:
                league_standings[league][h]['points'] += 3
            elif h_g < a_g:
                league_standings[league][a]['points'] += 3
            else:
                league_standings[league][h]['points'] += 1
                league_standings[league][a]['points'] += 1

    return team_hist, ref_hist, team_last_date, main_league_teams, h2h_hist, league_standings


def compute_league_stats(df):
    """
    [PROPOSTA 3] Calcola le medie storiche di ogni statistica per lega.
    Usato per il target encoding della feature lega in predict.
    Ritorna un dict: { league: { 'stat_h': mean, 'stat_a': mean }, '__global__': {...} }
    """
    league_raw  = {}  # league -> { stat: { 'home': [], 'away': [] } }
    global_h    = {s: [] for s in STATS}
    global_a    = {s: [] for s in STATS}

    for row in df.itertuples():
        league = str(getattr(row, 'league', '') or '')
        row_d  = row._asdict()

        if league not in league_raw:
            league_raw[league] = {s: {'home': [], 'away': []} for s in STATS}

        for s in STATS:
            hv = get_stat(row_d, s, True)
            av = get_stat(row_d, s, False)
            if hv is not None:
                league_raw[league][s]['home'].append(hv)
                global_h[s].append(hv)
            if av is not None:
                league_raw[league][s]['away'].append(av)
                global_a[s].append(av)

    # Calcola medie globali (fallback per leghe sconosciute)
    global_avgs = {}
    for s in STATS:
        global_avgs[f'{s}_h'] = float(np.mean(global_h[s])) if global_h[s] else 0.0
        global_avgs[f'{s}_a'] = float(np.mean(global_a[s])) if global_a[s] else 0.0

    result = {'__global__': global_avgs}
    for league, data in league_raw.items():
        result[league] = {}
        for s in STATS:
            result[league][f'{s}_h'] = float(np.mean(data[s]['home'])) if data[s]['home'] else global_avgs[f'{s}_h']
            result[league][f'{s}_a'] = float(np.mean(data[s]['away'])) if data[s]['away'] else global_avgs[f'{s}_a']

    return result


def build_features_for_match(home, away, ref, team_hist, ref_hist,
                               league_avgs=None, league=None,
                               team_last_date=None, main_league_teams=None,
                               h2h_hist=None, league_standings=None,
                               competition_type='league', match_date=None,
                               ai_context=None):
    """
    Costruisce il dizionario di feature per una singola partita.
    [PROPOSTA 1] Include feature SofaScore per tutte le statistiche.
    [PROPOSTA 3] Include feature lega (target encoding).
    """
    features = {}
    ref = str(ref or '')

    # 1. competition_type one-hot encoding
    comp_type = competition_type or 'league'
    features['f_comp_league'] = 1.0 if comp_type == 'league' else 0.0
    features['f_comp_cup_national'] = 1.0 if comp_type == 'cup_national' else 0.0
    features['f_comp_cup_european'] = 1.0 if comp_type == 'cup_european' else 0.0

    # 2. Days of rest
    rest_home = np.nan
    if main_league_teams and home in main_league_teams:
        last_d = team_last_date.get(home) if team_last_date else None
        if last_d is not None and match_date is not None:
            m_dt = pd.to_datetime(match_date)
            rest_home = float(max(0, (m_dt - last_d).days))
            
    rest_away = np.nan
    if main_league_teams and away in main_league_teams:
        last_d = team_last_date.get(away) if team_last_date else None
        if last_d is not None and match_date is not None:
            m_dt = pd.to_datetime(match_date)
            rest_away = float(max(0, (m_dt - last_d).days))

    features['f_rest_days_home'] = rest_home
    features['f_rest_days_away'] = rest_away
    features['f_rest_diff'] = (rest_home - rest_away) if (not pd.isna(rest_home) and not pd.isna(rest_away)) else np.nan

    # 3. Normalised Standings
    def get_standings_pct_local(standings, t_name):
        if not standings or t_name not in standings:
            return 0.5
        team_ppg = []
        for t, stats in standings.items():
            ppg = stats['points'] / stats['played'] if stats['played'] > 0 else 0.0
            team_ppg.append((t, ppg))
        team_ppg.sort(key=lambda x: (-x[1], -standings[x[0]]['points'], x[0]))
        rank = 0
        for idx, (t, _) in enumerate(team_ppg):
            if t == t_name:
                rank = idx
                break
        n_teams = len(team_ppg)
        if n_teams <= 1: return 0.5
        return float(rank) / (n_teams - 1)

    standings_l = league_standings.get(league) if (league_standings and league) else None
    features['f_standing_home'] = get_standings_pct_local(standings_l, home) if comp_type == 'league' else np.nan
    features['f_standing_away'] = get_standings_pct_local(standings_l, away) if comp_type == 'league' else np.nan

    # 5. AI news context features (Fase 4)
    ai = ai_context or {}
    inj_home = ai.get('injury_impact_home', np.nan)
    inj_away = ai.get('injury_impact_away', np.nan)
    mot_home = ai.get('motivation_home', np.nan)
    mot_away = ai.get('motivation_away', np.nan)

    # Cast to float or NaN
    inj_home = float(inj_home) if (inj_home is not None and not pd.isna(inj_home)) else np.nan
    inj_away = float(inj_away) if (inj_away is not None and not pd.isna(inj_away)) else np.nan
    mot_home = float(mot_home) if (mot_home is not None and not pd.isna(mot_home)) else np.nan
    mot_away = float(mot_away) if (mot_away is not None and not pd.isna(mot_away)) else np.nan

    features['f_injury_impact_home'] = inj_home
    features['f_injury_impact_away'] = inj_away
    features['f_injury_impact_diff'] = (inj_home - inj_away) if (not pd.isna(inj_home) and not pd.isna(inj_away)) else np.nan
    features['f_motivation_home'] = mot_home
    features['f_motivation_away'] = mot_away
    features['f_motivation_diff'] = (mot_home - mot_away) if (not pd.isna(mot_home) and not pd.isna(mot_away)) else np.nan

    # 4. Direct H2H rolling averages
    h2h_key = tuple(sorted([home, away]))
    past_h2h = h2h_hist.get(h2h_key, []) if h2h_hist else []
    for s in STATS:
        home_achieved = []
        away_achieved = []
        for m in past_h2h:
            if m['home'] == home:
                home_achieved.append(m['stats_home'][s])
                away_achieved.append(m['stats_away'][s])
            else:
                home_achieved.append(m['stats_away'][s])
                away_achieved.append(m['stats_home'][s])
        features[f'f_{s}_h2h_avg_3_home'] = _avg(home_achieved, 3) if home_achieved else np.nan
        features[f'f_{s}_h2h_avg_3_away'] = _avg(away_achieved, 3) if away_achieved else np.nan
        features[f'f_{s}_h2h_avg_5_home'] = _avg(home_achieved, 5) if home_achieved else np.nan
        features[f'f_{s}_h2h_avg_5_away'] = _avg(away_achieved, 5) if away_achieved else np.nan

    # ── FEATURE PRINCIPALI (STATS) ──
    for s in STATS:
        empty = {'for_all': [], 'ag_all': [], 'home_for': [], 'home_ag': [], 'away_for': [], 'away_ag': []}
        h = team_hist.get(home, {}).get(s, empty)
        a = team_hist.get(away, {}).get(s, empty)

        # Rolling home
        features[f'f_{s}_h_for3']  = _avg(h['for_all'], 3)
        features[f'f_{s}_h_for5']  = _avg(h['for_all'], 5)
        features[f'f_{s}_h_for10'] = _avg(h['for_all'], 10)
        features[f'f_{s}_h_ag3']   = _avg(h['ag_all'],  3)
        features[f'f_{s}_h_ag5']   = _avg(h['ag_all'],  5)
        features[f'f_{s}_h_ag10']  = _avg(h['ag_all'],  10)
        features[f'f_{s}_h_hfor']  = _avg(h['home_for'], 5) or features[f'f_{s}_h_for5']
        features[f'f_{s}_h_hag']   = _avg(h['home_ag'],  5) or features[f'f_{s}_h_ag5']

        # Rolling away
        features[f'f_{s}_a_for3']  = _avg(a['for_all'], 3)
        features[f'f_{s}_a_for5']  = _avg(a['for_all'], 5)
        features[f'f_{s}_a_for10'] = _avg(a['for_all'], 10)
        features[f'f_{s}_a_ag3']   = _avg(a['ag_all'],  3)
        features[f'f_{s}_a_ag5']   = _avg(a['ag_all'],  5)
        features[f'f_{s}_a_ag10']  = _avg(a['ag_all'],  10)
        features[f'f_{s}_a_afor']  = _avg(a['away_for'], 5) or features[f'f_{s}_a_for5']
        features[f'f_{s}_a_aag']   = _avg(a['away_ag'],  5) or features[f'f_{s}_a_ag5']

        # Differenziali
        features[f'f_{s}_str_h'] = features[f'f_{s}_h_for5'] - features[f'f_{s}_a_ag5']
        features[f'f_{s}_str_a'] = features[f'f_{s}_a_for5'] - features[f'f_{s}_h_ag5']

        # Arbitro
        if s in ('falli', 'cartellini'):
            ref_vals = ref_hist.get(ref, {}).get(s, [])
            fallback = features[f'f_{s}_h_for5'] + features[f'f_{s}_a_for5']
            features[f'f_{s}_ref'] = _avg(ref_vals, 10) if ref_vals else fallback

        # Hit Rates, Deviazione Standard, Mediana
        thresholds = HIT_RATE_THRESHOLDS[s]
        for i, thr in enumerate(thresholds, 1):
            features[f'f_{s}_h_for_hr{i}']      = _hit_rate(h['for_all'],  10, thr)
            features[f'f_{s}_h_ag_hr{i}']       = _hit_rate(h['ag_all'],   10, thr)
            features[f'f_{s}_h_spec_for_hr{i}'] = _hit_rate(h['home_for'], 10, thr)
            features[f'f_{s}_h_spec_ag_hr{i}']  = _hit_rate(h['home_ag'],  10, thr)
            features[f'f_{s}_a_for_hr{i}']      = _hit_rate(a['for_all'],  10, thr)
            features[f'f_{s}_a_ag_hr{i}']       = _hit_rate(a['ag_all'],   10, thr)
            features[f'f_{s}_a_spec_for_hr{i}'] = _hit_rate(a['away_for'], 10, thr)
            features[f'f_{s}_a_spec_ag_hr{i}']  = _hit_rate(a['away_ag'],  10, thr)
        features[f'f_{s}_h_for_std'] = _std(h['for_all'], 10)
        features[f'f_{s}_h_ag_std']  = _std(h['ag_all'],  10)
        features[f'f_{s}_a_for_std'] = _std(a['for_all'], 10)
        features[f'f_{s}_a_ag_std']  = _std(a['ag_all'],  10)
        features[f'f_{s}_h_for_med'] = _median(h['for_all'], 10)
        features[f'f_{s}_h_ag_med']  = _median(h['ag_all'],  10)
        features[f'f_{s}_a_for_med'] = _median(a['for_all'], 10)
        features[f'f_{s}_a_ag_med']  = _median(a['ag_all'],  10)

        # [PROPOSTA 3] Feature lega — target encoding
        global_avgs  = league_avgs.get('__global__', {}) if league_avgs else {}
        league_data  = league_avgs.get(league, global_avgs) if (league_avgs and league) else global_avgs
        features[f'f_league_{s}_h_avg'] = league_data.get(f'{s}_h', global_avgs.get(f'{s}_h', 0.0))
        features[f'f_league_{s}_a_avg'] = league_data.get(f'{s}_a', global_avgs.get(f'{s}_a', 0.0))

    # [PROPOSTA 1] Feature SofaScore per TUTTE le statistiche
    empty = {'for_all': [], 'ag_all': [], 'home_for': [], 'home_ag': [], 'away_for': [], 'away_ag': []}
    for s in SOFA_STATS:
        sh = team_hist.get(home, {}).get(s, empty)
        sa = team_hist.get(away, {}).get(s, empty)

        features[f'f_{s}_h_for5'] = _avg(sh['for_all'], 5)
        features[f'f_{s}_a_for5'] = _avg(sa['for_all'], 5)
        features[f'f_{s}_h_ag5']  = _avg(sh['ag_all'],  5)
        features[f'f_{s}_a_ag5']  = _avg(sa['ag_all'],  5)
        features[f'f_{s}_str_h']  = features[f'f_{s}_h_for5'] - features[f'f_{s}_a_ag5']
        features[f'f_{s}_str_a']  = features[f'f_{s}_a_for5'] - features[f'f_{s}_h_ag5']

        thresholds = HIT_RATE_THRESHOLDS[s]
        features[f'f_{s}_h_for_hr1'] = _hit_rate(sh['for_all'], 10, thresholds[0])
        features[f'f_{s}_a_for_hr1'] = _hit_rate(sa['for_all'], 10, thresholds[0])
        features[f'f_{s}_h_for_med'] = _median(sh['for_all'], 10)
        features[f'f_{s}_a_for_med'] = _median(sa['for_all'], 10)

    return features


def _predict_with_model(model, X_full, stat=None):
    """
    Helper: predice con modello singolo o Stack (con Ridge meta-learner).
    [PROPOSTA 4] Usa meta.predict() per gli Stack con Ridge.
    """
    if isinstance(model, dict):
        X_all_m    = X_full[model['x_all_cols']]
        X_pruned_m = X_full[model['x_pruned_cols']]
        
        # Imputazione con la mediana per il Random Forest dello Stack
        rf_med = model.get('rf_med')
        if rf_med is None and stat is not None:
            try:
                rf_med = joblib.load(os.path.join(MODELS_DIR, f'median_{stat}.joblib'))
            except:
                pass
        
        if rf_med is not None:
            X_all_m_rf = X_all_m.fillna(rf_med)
        else:
            X_all_m_rf = X_all_m.fillna(0)
            
        rf_p  = float(model['rf'].predict(X_all_m_rf)[0])
        xgb_p = float(model['xgb'].predict(X_pruned_m)[0])
        hgb_p = float(model['hgb'].predict(X_pruned_m)[0])

        if 'meta' in model:
            # [PROPOSTA 4] Ridge meta-learner (pesi ottimali appresi da OOF)
            meta_X = np.array([[rf_p, xgb_p, hgb_p]])
            return float(model['meta'].predict(meta_X)[0])
        else:
            # Backward compatibility: media semplice per vecchi modelli Stack
            return float((rf_p + xgb_p + hgb_p) / 3)
    else:
        if hasattr(model, 'feature_names_in_'):
            X_m = X_full[model.feature_names_in_]
        else:
            X_m = X_full
            
        # Imputazione con la mediana se il modello singolo è Random Forest
        if 'RandomForestRegressor' in str(type(model)) and stat is not None:
            try:
                rf_med = joblib.load(os.path.join(MODELS_DIR, f'median_{stat}.joblib'))
                X_m = X_m.fillna(rf_med)
            except:
                X_m = X_m.fillna(0)
                
        return float(model.predict(X_m)[0])


# ─────────────────────────────────────────────────────────────
# PREDIZIONE BATCH
# ─────────────────────────────────────────────────────────────
def predict_batch(matches):
    try:
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resoconto.db')
        conn    = sqlite3.connect(db_path, timeout=30)
        df      = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
        conn.close()

        target_teams = set()
        target_refs  = set()
        for m in matches:
            target_teams.add(m['home'])
            target_teams.add(m['away'])
            if m.get('referee'):
                target_refs.add(str(m['referee']))

        # [PROPOSTA 1] Ora traccia ALL_STATS per ogni squadra
        team_hist, ref_hist, team_last_date, main_league_teams, h2h_hist, league_standings = calculate_team_features(df, target_teams, target_refs)

        # [PROPOSTA 3] Calcola medie di lega per il target encoding
        league_avgs = compute_league_stats(df)

        # Carica tutti i modelli una sola volta
        models     = {}
        var_models = {}
        for s in STATS:
            models[f'{s}_casa']   = joblib.load(os.path.join(MODELS_DIR, f'model_{s}_casa.joblib'))
            models[f'{s}_ospite'] = joblib.load(os.path.join(MODELS_DIR, f'model_{s}_ospite.joblib'))
            try:
                var_models[f'{s}_casa']   = joblib.load(os.path.join(VARIANCE_MODELS_DIR, f'variance_{s}_casa.joblib'))
                var_models[f'{s}_ospite'] = joblib.load(os.path.join(VARIANCE_MODELS_DIR, f'variance_{s}_ospite.joblib'))
            except FileNotFoundError:
                var_models[f'{s}_casa']   = None
                var_models[f'{s}_ospite'] = None

        # Fetch cached AI context for matches in the batch (Fase 4)
        conn = sqlite3.connect(db_path, timeout=30)
        ai_contexts = {}
        for m in matches:
            home = m['home']
            away = m['away']
            dt = m.get('date', '')
            key = f"{home}_{away}_{dt}"
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT injury_impact_home, injury_impact_away, motivation_home, motivation_away FROM match_ai_context WHERE match_key = ?", (key,))
                row = cursor.fetchone()
                if row:
                    ai_contexts[key] = {
                        'injury_impact_home': row[0],
                        'injury_impact_away': row[1],
                        'motivation_home': row[2],
                        'motivation_away': row[3]
                    }
                else:
                    ai_contexts[key] = None
            except sqlite3.OperationalError:
                ai_contexts[key] = None
        conn.close()

        batch_results = []
        for m in matches:
            home   = m['home']
            away   = m['away']
            ref    = m.get('referee', '')
            league = m.get('league', '')   # [PROPOSTA 3] lega della partita

            feats = build_features_for_match(
                home, away, ref, team_hist, ref_hist,
                league_avgs=league_avgs, league=league,
                team_last_date=team_last_date, main_league_teams=main_league_teams,
                h2h_hist=h2h_hist, league_standings=league_standings,
                competition_type=m.get('competition_type', 'league'), match_date=m.get('date'),
                ai_context=ai_contexts.get(f"{home}_{away}_{m.get('date', '')}")
            )
            match_preds = {}

            for s in STATS:
                fcols  = get_feature_cols(s)
                # Sostituiamo feats.get(c, 0) con feats.get(c, np.nan) per preservare i NaN reali!
                X_full = pd.DataFrame([{c: feats.get(c, np.nan) for c in fcols}])

                # Previsione EV (Casa e Ospite)
                pred_c = _predict_with_model(models[f'{s}_casa'],   X_full, stat=s)
                pred_o = _predict_with_model(models[f'{s}_ospite'],  X_full, stat=s)

                match_preds[s] = {'casa': round(pred_c, 2), 'ospite': round(pred_o, 2)}

                # Previsione Varianza (con clipping a 0.01 per evitare valori irrealistici o negativi)
                if var_models[f'{s}_casa'] is not None and var_models[f'{s}_ospite'] is not None:
                    var_model_c = var_models[f'{s}_casa']
                    X_var_c     = X_full[var_model_c.feature_names_in_] if hasattr(var_model_c, 'feature_names_in_') else X_full
                    var_c       = max(float(var_model_c.predict(X_var_c)[0]), 0.01)

                    var_model_o = var_models[f'{s}_ospite']
                    X_var_o     = X_full[var_model_o.feature_names_in_] if hasattr(var_model_o, 'feature_names_in_') else X_full
                    var_o       = max(float(var_model_o.predict(X_var_o)[0]), 0.01)

                    match_preds[s]['casa_var']   = round(var_c, 4)
                    match_preds[s]['ospite_var'] = round(var_o, 4)

            batch_results.append(match_preds)

        print(json.dumps(batch_results))

    except Exception as e:
        import traceback
        print(json.dumps({'error': traceback.format_exc()}))
        sys.exit(1)


# ─────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch',      help='JSON string con lista partite')
    parser.add_argument('--batch-file', help='Path a file JSON con lista partite')
    parser.add_argument('--home')
    parser.add_argument('--away')
    parser.add_argument('--referee', default='')
    parser.add_argument('--league',  default='', help='Lega della partita (per target encoding)')
    args = parser.parse_args()

    if args.batch_file:
        with open(args.batch_file, 'r', encoding='utf-8') as f:
            matches = json.load(f)
        predict_batch(matches)
    elif args.batch:
        predict_batch(json.loads(args.batch))
    elif args.home and args.away:
        predict_batch([{'home': args.home, 'away': args.away,
                        'referee': args.referee, 'league': args.league}])
    else:
        print(json.dumps({'error': 'Argomenti mancanti: usa --home/--away o --batch'}))
        sys.exit(1)