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
    # team_hist ora include ALL_STATS (non solo STATS)
    team_hist = {t: {s: {'for_all': [], 'ag_all': [],
                          'home_for': [], 'home_ag': [],
                          'away_for': [], 'away_ag': []}
                     for s in ALL_STATS}
                 for t in target_teams}
    ref_hist  = {r: {s: [] for s in STATS} for r in target_refs if r}

    for row in df.itertuples():
        h   = row.home_team
        a   = row.away_team
        ref = str(getattr(row, 'referee', '') or '')

        for s in ALL_STATS:
            row_d = row._asdict()
            hv    = get_stat(row_d, s, True)
            av    = get_stat(row_d, s, False)

            # Salta None (dati SofaScore mancanti per le partite più vecchie)
            if hv is None or av is None:
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

    return team_hist, ref_hist


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
                               league_avgs=None, league=None):
    """
    Costruisce il dizionario di feature per una singola partita.
    [PROPOSTA 1] Include feature SofaScore per tutte le statistiche.
    [PROPOSTA 3] Include feature lega (target encoding).
    """
    features = {}
    ref = str(ref or '')

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


def _predict_with_model(model, X_full):
    """
    Helper: predice con modello singolo o Stack (con Ridge meta-learner).
    [PROPOSTA 4] Usa meta.predict() per gli Stack con Ridge.
    """
    if isinstance(model, dict):
        X_all_m    = X_full[model['x_all_cols']]
        X_pruned_m = X_full[model['x_pruned_cols']]
        rf_p  = float(model['rf'].predict(X_all_m)[0])
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
        X_m = X_full[model.feature_names_in_] if hasattr(model, 'feature_names_in_') else X_full
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
        team_hist, ref_hist = calculate_team_features(df, target_teams, target_refs)

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

        batch_results = []
        for m in matches:
            home   = m['home']
            away   = m['away']
            ref    = m.get('referee', '')
            league = m.get('league', '')   # [PROPOSTA 3] lega della partita

            feats = build_features_for_match(
                home, away, ref, team_hist, ref_hist,
                league_avgs=league_avgs, league=league
            )
            match_preds = {}

            for s in STATS:
                fcols  = get_feature_cols(s)
                X_full = pd.DataFrame([{c: feats.get(c, 0) for c in fcols}])

                # Previsione EV (Casa e Ospite)
                pred_c = _predict_with_model(models[f'{s}_casa'],   X_full)
                pred_o = _predict_with_model(models[f'{s}_ospite'],  X_full)

                match_preds[s] = {'casa': round(pred_c, 2), 'ospite': round(pred_o, 2)}

                # Previsione Varianza
                if var_models[f'{s}_casa'] is not None and var_models[f'{s}_ospite'] is not None:
                    var_model_c = var_models[f'{s}_casa']
                    X_var_c     = X_full[var_model_c.feature_names_in_] if hasattr(var_model_c, 'feature_names_in_') else X_full
                    var_c       = float(var_model_c.predict(X_var_c)[0])

                    var_model_o = var_models[f'{s}_ospite']
                    X_var_o     = X_full[var_model_o.feature_names_in_] if hasattr(var_model_o, 'feature_names_in_') else X_full
                    var_o       = float(var_model_o.predict(X_var_o)[0])

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