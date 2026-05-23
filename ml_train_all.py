import sqlite3
import pandas as pd
import numpy as np
import os
import time
os.environ["PYTHONWARNINGS"] = "ignore"
import json
import joblib
import argparse
import warnings
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor, VotingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import KFold
import xgboost as xgb
import optuna
import shap
import libsql_client as libsql
optuna.logging.set_verbosity(optuna.logging.WARNING)
warnings.filterwarnings('ignore')

# ═══════════════════════════════════════════════════════════════
# COSTANTI
# ═══════════════════════════════════════════════════════════════
STATS = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate']

# [PROPOSTA 1] Aggiunte feature tattiche e generali a SofaScore
SOFA_STATS = ['xg', 'possession', 'shots_insidebox', 'big_chances', 'offsides', 
              'passes', 'crosses', 'tackles', 'interceptions']
ALL_STATS = STATS + SOFA_STATS

# Soglie Over/Under per il calcolo delle Hit Rates
HIT_RATE_THRESHOLDS = {
    'gol':             [0.5, 1.5, 2.5],
    'tiri':            [8.5, 10.5, 12.5],
    'tip':             [2.5, 4.5, 6.5],
    'falli':           [10.5, 12.5, 14.5],
    'corner':          [3.5, 4.5, 5.5],
    'cartellini':      [1.5, 2.5, 3.5],
    'parate':          [1.5, 2.5, 3.5],
    'xg':              [0.5, 1.5, 2.5],
    'possession':      [45.0, 50.0, 55.0],
    'shots_insidebox': [5.5, 8.5, 11.5],
    'big_chances':     [1.5, 2.5, 3.5],
    'offsides':        [1.5, 2.5, 3.5],
    'passes':          [300.5, 400.5, 500.5],
    'crosses':         [10.5, 15.5, 20.5],
    'tackles':         [10.5, 15.5, 20.5],
    'interceptions':   [6.5, 9.5, 12.5],
}

SCRIPT_DIR            = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR            = os.path.join(SCRIPT_DIR, 'models')
METRICS_PATH          = os.path.join(MODELS_DIR, 'metrics.json')
BEST_PARAMS_PATH      = os.path.join(MODELS_DIR, 'best_params.json')
COUNT_PATH            = os.path.join(MODELS_DIR, 'match_count.json')
SELECTED_FEATURES_PATH = os.path.join(MODELS_DIR, 'selected_features.json')
TUNE_EVERY_N          = 50
N_OPTUNA_TRIALS       = 150

# [PROPOSTA 2] λ per il decadimento esponenziale temporale dei pesi
# Con λ=0.5: una partita di 2 anni fa vale e^(-1) ≈ 0.37 rispetto ad una recente
TIME_DECAY_LAMBDA     = 0.5

VARIANCE_MODELS_DIR       = os.path.join(MODELS_DIR, 'variance')
VARIANCE_METRICS_PATH     = os.path.join(VARIANCE_MODELS_DIR, 'variance_metrics.json')
VARIANCE_BEST_PARAMS_PATH = os.path.join(VARIANCE_MODELS_DIR, 'variance_best_params.json')


# ═══════════════════════════════════════════════════════════════
# HELPER: LETTURA STATISTICA DA RIGA
# ═══════════════════════════════════════════════════════════════
def get_stat(row, stat, is_home):
    mapping = {
        'gol':    ('home_goals',   'away_goals'),
        'tiri':   ('home_shots',   'away_shots'),
        'tip':    ('home_sot',     'away_sot'),
        'falli':  ('home_fouls',   'away_fouls'),
        'corner': ('home_corners', 'away_corners'),
    }
    # [PROPOSTA 1] Mapping feature tattiche
    sofa_mapping = {
        'xg':              ('home_xg',               'away_xg'),
        'possession':      ('home_possession',        'away_possession'),
        'shots_insidebox': ('home_shots_insidebox',   'away_shots_insidebox'),
        'big_chances':     ('home_big_chances',       'away_big_chances'),
        'offsides':        ('home_offsides',          'away_offsides'),
        'passes':          ('home_passes',            'away_passes'),
        'crosses':         ('home_crosses',           'away_crosses'),
        'tackles':         ('home_tackles',           'away_tackles'),
        'interceptions':   ('home_interceptions',     'away_interceptions'),
    }

    if stat in mapping:
        col = mapping[stat][0] if is_home else mapping[stat][1]
        return float(row.get(col, 0) or 0)

    if stat in sofa_mapping:
        col = sofa_mapping[stat][0] if is_home else sofa_mapping[stat][1]
        val = row.get(col)
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return None
        return float(val)

    if stat == 'cartellini':
        y_col = 'home_yellows' if is_home else 'away_yellows'
        r_col = 'home_reds'    if is_home else 'away_reds'
        return float((row.get(y_col, 0) or 0) + (row.get(r_col, 0) or 0) * 2)

    if stat == 'parate':
        tip_sub = row.get('away_sot'   if is_home else 'home_sot',   0) or 0
        gol_sub = row.get('away_goals' if is_home else 'home_goals', 0) or 0
        return float(max(0, tip_sub - gol_sub))

    return 0.0


def _avg(lst, n):
    if not lst: return 0.0
    return float(np.mean(lst[-n:]))

def _hit_rate(lst, n, threshold):
    """Percentuale di valori negli ultimi n che superano la soglia (Hit Rate)."""
    recent = lst[-n:] if lst else []
    if not recent: return 0.0
    return float(sum(1 for v in recent if v > threshold) / len(recent))

def _median(lst, n):
    """Mediana degli ultimi n valori. Robusta agli outlier."""
    recent = lst[-n:] if lst else []
    if not recent: return 0.0
    return float(np.median(recent))

def _std(lst, n):
    """Deviazione standard degli ultimi n valori. Misura di consistenza."""
    recent = lst[-n:] if lst else []
    if len(recent) < 2: return 0.0
    return float(np.std(recent))


# ═══════════════════════════════════════════════════════════════
# COLONNE FEATURE — usate sia in training che in predict
# ═══════════════════════════════════════════════════════════════
def get_feature_cols(stat):
    cols = [
        # Rolling windows home team (tutti i match)
        f'f_{stat}_h_for3',  f'f_{stat}_h_for5',  f'f_{stat}_h_for10',
        f'f_{stat}_h_ag3',   f'f_{stat}_h_ag5',   f'f_{stat}_h_ag10',
        # Solo partite in casa (home team)
        f'f_{stat}_h_hfor',  f'f_{stat}_h_hag',
        # Rolling windows away team (tutti i match)
        f'f_{stat}_a_for3',  f'f_{stat}_a_for5',  f'f_{stat}_a_for10',
        f'f_{stat}_a_ag3',   f'f_{stat}_a_ag5',   f'f_{stat}_a_ag10',
        # Solo partite in trasferta (away team)
        f'f_{stat}_a_afor',  f'f_{stat}_a_aag',
        # Differenziali di forza
        f'f_{stat}_str_h',   f'f_{stat}_str_a',
    ]

    # [PROPOSTA 1] Feature SofaScore per TUTTE le statistiche (non solo GOL)
    # Il pruning SHAP (90% importanza cumulativa) filtrerà quelle non rilevanti per ciascun target
    for s in SOFA_STATS:
        cols.extend([
            f'f_{s}_h_for5', f'f_{s}_a_for5',
            f'f_{s}_h_ag5',  f'f_{s}_a_ag5',
            f'f_{s}_str_h',  f'f_{s}_str_a',
            f'f_{s}_h_for_hr1', f'f_{s}_a_for_hr1',
            f'f_{s}_h_for_med', f'f_{s}_a_for_med',
        ])

    if stat in ('falli', 'cartellini'):
        cols.append(f'f_{stat}_ref')

    # [PROPOSTA 3] Feature lega: target encoding rolling (senza data leakage)
    cols.append(f'f_league_{stat}_h_avg')
    cols.append(f'f_league_{stat}_a_avg')

    # --- Hit Rates, Deviazione Standard, Mediana ---
    thresholds = HIT_RATE_THRESHOLDS[stat]
    for side in ('h', 'a'):
        for i in range(1, len(thresholds) + 1):
            cols.append(f'f_{stat}_{side}_for_hr{i}')
            cols.append(f'f_{stat}_{side}_ag_hr{i}')
            cols.append(f'f_{stat}_{side}_spec_for_hr{i}')
            cols.append(f'f_{stat}_{side}_spec_ag_hr{i}')
        cols.append(f'f_{stat}_{side}_for_std')
        cols.append(f'f_{stat}_{side}_ag_std')
        cols.append(f'f_{stat}_{side}_for_med')
        cols.append(f'f_{stat}_{side}_ag_med')

    return cols


# ═══════════════════════════════════════════════════════════════
# CARICAMENTO DATI
# ═══════════════════════════════════════════════════════════════
def load_data(db_path='resoconto.db'):
    env = {}
    if os.path.exists('.env.local'):
        with open('.env.local', 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    env[k] = v.strip().strip('"')

    url   = env.get('TURSO_DATABASE_URL')
    token = env.get('TURSO_AUTH_TOKEN')

    if url and token:
        print(f"[DB] Connessione a Turso in corso...")
        client = libsql.create_client_sync(url, auth_token=token)
        res    = client.execute("SELECT * FROM matches ORDER BY date ASC")
        df     = pd.DataFrame(res.rows, columns=res.columns)
        client.close()
    else:
        print(f"[DB] Connessione al database locale ({db_path})...")
        conn = sqlite3.connect(db_path, timeout=30)
        df   = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
        conn.close()

    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).sort_values('date').reset_index(drop=True)
    return df


# ═══════════════════════════════════════════════════════════════
# FEATURE ENGINEERING AVANZATA
# ═══════════════════════════════════════════════════════════════
def feature_engineering(df):
    """
    Costruisce il DataFrame di feature per il training.
    Ritorna: (ml_df, sample_weights)
      - ml_df: DataFrame di feature (senza colonne __*)
      - sample_weights: np.array di pesi time-decay [PROPOSTA 2]
    """
    print(f"Creando feature avanzate su {len(df)} partite...")
    features   = []
    team_hist  = {}
    ref_hist   = {}
    league_hist = {}   # [PROPOSTA 3] storico rolling per lega

    for _, row in df.iterrows():
        home   = row['home_team']
        away   = row['away_team']
        ref    = str(row.get('referee', '') or '')
        league = str(row.get('league',  '') or '')   # [PROPOSTA 3]

        # Inizializza strutture se mancanti
        for team in (home, away):
            if team not in team_hist:
                team_hist[team] = {
                    s: {'for_all': [], 'ag_all': [],
                        'home_for': [], 'home_ag': [],
                        'away_for': [], 'away_ag': []}
                    for s in ALL_STATS
                }
        if ref not in ref_hist:
            ref_hist[ref] = {s: [] for s in ALL_STATS}

        # [PROPOSTA 3] Inizializza storico lega
        if league not in league_hist:
            league_hist[league] = {s: {'home': [], 'away': []} for s in STATS}

        # Richiedi almeno 3 partite per entrambe le squadre
        if (len(team_hist[home]['gol']['for_all']) < 3 or
                len(team_hist[away]['gol']['for_all']) < 3):
            # Aggiorna storia e vai avanti senza aggiungere riga
            for s in ALL_STATS:
                hv = get_stat(row, s, True)
                av = get_stat(row, s, False)
                _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av)
            # [PROPOSTA 3] Aggiorna anche lo storico lega per i match saltati
            for s in STATS:
                hv = get_stat(row, s, True)
                av = get_stat(row, s, False)
                if hv is not None: league_hist[league][s]['home'].append(hv)
                if av is not None: league_hist[league][s]['away'].append(av)
            continue

        row_feat = {}

        for s in ALL_STATS:
            h = team_hist[home][s]
            a = team_hist[away][s]

            # Home team rolling
            row_feat[f'f_{s}_h_for3']  = _avg(h['for_all'], 3)
            row_feat[f'f_{s}_h_for5']  = _avg(h['for_all'], 5)
            row_feat[f'f_{s}_h_for10'] = _avg(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag3']   = _avg(h['ag_all'],  3)
            row_feat[f'f_{s}_h_ag5']   = _avg(h['ag_all'],  5)
            row_feat[f'f_{s}_h_ag10']  = _avg(h['ag_all'],  10)
            row_feat[f'f_{s}_h_hfor']  = _avg(h['home_for'], 5) or row_feat[f'f_{s}_h_for5']
            row_feat[f'f_{s}_h_hag']   = _avg(h['home_ag'],  5) or row_feat[f'f_{s}_h_ag5']

            # Away team rolling
            row_feat[f'f_{s}_a_for3']  = _avg(a['for_all'], 3)
            row_feat[f'f_{s}_a_for5']  = _avg(a['for_all'], 5)
            row_feat[f'f_{s}_a_for10'] = _avg(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag3']   = _avg(a['ag_all'],  3)
            row_feat[f'f_{s}_a_ag5']   = _avg(a['ag_all'],  5)
            row_feat[f'f_{s}_a_ag10']  = _avg(a['ag_all'],  10)
            row_feat[f'f_{s}_a_afor']  = _avg(a['away_for'], 5) or row_feat[f'f_{s}_a_for5']
            row_feat[f'f_{s}_a_aag']   = _avg(a['away_ag'],  5) or row_feat[f'f_{s}_a_ag5']

            # Differenziali di forza
            row_feat[f'f_{s}_str_h'] = row_feat[f'f_{s}_h_for5'] - row_feat[f'f_{s}_a_ag5']
            row_feat[f'f_{s}_str_a'] = row_feat[f'f_{s}_a_for5'] - row_feat[f'f_{s}_h_ag5']

            # Arbitro (solo falli/cartellini)
            if s in ('falli', 'cartellini'):
                ref_vals = ref_hist[ref][s]
                fallback = row_feat[f'f_{s}_h_for5'] + row_feat[f'f_{s}_a_for5']
                row_feat[f'f_{s}_ref'] = _avg(ref_vals, 10) if ref_vals else fallback

            # Hit Rates, Deviazione Standard, Mediana (per tutte le statistiche)
            thresholds = HIT_RATE_THRESHOLDS[s]
            for i, thr in enumerate(thresholds, 1):
                row_feat[f'f_{s}_h_for_hr{i}']      = _hit_rate(h['for_all'],  10, thr)
                row_feat[f'f_{s}_h_ag_hr{i}']       = _hit_rate(h['ag_all'],   10, thr)
                row_feat[f'f_{s}_h_spec_for_hr{i}'] = _hit_rate(h['home_for'], 10, thr)
                row_feat[f'f_{s}_h_spec_ag_hr{i}']  = _hit_rate(h['home_ag'],  10, thr)
                row_feat[f'f_{s}_a_for_hr{i}']      = _hit_rate(a['for_all'],  10, thr)
                row_feat[f'f_{s}_a_ag_hr{i}']       = _hit_rate(a['ag_all'],   10, thr)
                row_feat[f'f_{s}_a_spec_for_hr{i}'] = _hit_rate(a['away_for'], 10, thr)
                row_feat[f'f_{s}_a_spec_ag_hr{i}']  = _hit_rate(a['away_ag'],  10, thr)
            row_feat[f'f_{s}_h_for_std'] = _std(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag_std']  = _std(h['ag_all'],  10)
            row_feat[f'f_{s}_a_for_std'] = _std(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag_std']  = _std(a['ag_all'],  10)
            row_feat[f'f_{s}_h_for_med'] = _median(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag_med']  = _median(h['ag_all'],  10)
            row_feat[f'f_{s}_a_for_med'] = _median(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag_med']  = _median(a['ag_all'],  10)

        # [PROPOSTA 3] Feature lega — calcolate PRIMA di aggiornare lo storico (no data leakage)
        for s in STATS:
            h_vals = league_hist[league][s]['home']
            a_vals = league_hist[league][s]['away']
            row_feat[f'f_league_{s}_h_avg'] = float(np.mean(h_vals)) if h_vals else 0.0
            row_feat[f'f_league_{s}_a_avg'] = float(np.mean(a_vals)) if a_vals else 0.0

        # Target variables
        for s in STATS:
            row_feat[f'target_{s}_casa']   = get_stat(row, s, True)
            row_feat[f'target_{s}_ospite'] = get_stat(row, s, False)

        row_feat['__has_sofa__'] = (get_stat(row, 'xg', True) is not None)
        row_feat['__date__']     = row['date']   # [PROPOSTA 2] per time-decay

        features.append(row_feat)

        # Aggiorna storia team
        for s in ALL_STATS:
            hv = get_stat(row, s, True)
            av = get_stat(row, s, False)
            _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av)

        # [PROPOSTA 3] Aggiorna storico lega
        for s in STATS:
            hv = get_stat(row, s, True)
            av = get_stat(row, s, False)
            if hv is not None: league_hist[league][s]['home'].append(hv)
            if av is not None: league_hist[league][s]['away'].append(av)

    result = pd.DataFrame(features)
    print("DataFrame columns:", result.columns.tolist() if not result.empty else "EMPTY")
    if not result.empty and '__has_sofa__' in result.columns:
        print("__has_sofa__ counts:", result['__has_sofa__'].value_counts().to_dict())

    if '__has_sofa__' in result.columns:
        result = result[result['__has_sofa__'] == True].drop(columns=['__has_sofa__'])
    else:
        print("ERROR: __has_sofa__ column is missing!")

    # [PROPOSTA 2] Calcola sample_weight con decadimento esponenziale temporale
    dates = pd.to_datetime(result['__date__'], errors='coerce')
    result = result.drop(columns=['__date__'], errors='ignore')
    result = result.fillna(0)

    most_recent = dates.max()
    days_diff   = (most_recent - dates).dt.days.fillna(0) / 365.25
    sample_weights = np.exp(-TIME_DECAY_LAMBDA * days_diff).values

    print(f"  >> {len(result)} partite valide per il training.")
    return result, sample_weights


def _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av):
    if hv is None or av is None:
        return  # Salta le partite mancanti dei dati SofaScore

    team_hist[home][s]['for_all'].append(hv)
    team_hist[home][s]['ag_all'].append(av)
    team_hist[home][s]['home_for'].append(hv)
    team_hist[home][s]['home_ag'].append(av)
    team_hist[away][s]['for_all'].append(av)
    team_hist[away][s]['ag_all'].append(hv)
    team_hist[away][s]['away_for'].append(av)
    team_hist[away][s]['away_ag'].append(hv)
    ref_hist[ref][s].append(hv + av)


# ═══════════════════════════════════════════════════════════════
# COSTRUZIONE MODELLO
# ═══════════════════════════════════════════════════════════════
def build_model(model_type, params=None):
    p = params or {}
    if model_type == 'rf':
        return RandomForestRegressor(
            n_estimators=p.get('n_estimators', 200),
            max_depth=p.get('max_depth', 6),
            min_samples_leaf=p.get('min_samples_leaf', 5),
            random_state=42, n_jobs=-1
        )
    if model_type == 'xgb':
        return xgb.XGBRegressor(
            n_estimators=p.get('n_estimators', 200),
            max_depth=p.get('max_depth', 5),
            learning_rate=p.get('learning_rate', 0.05),
            subsample=p.get('subsample', 0.8),
            colsample_bytree=p.get('colsample_bytree', 0.8),
            objective='count:poisson',
            random_state=42, n_jobs=-1, verbosity=0
        )
    if model_type == 'hgb':
        return HistGradientBoostingRegressor(
            loss='poisson',
            max_iter=p.get('max_iter', 200),
            max_depth=p.get('max_depth', 5),
            min_samples_leaf=p.get('min_samples_leaf', 10),
            learning_rate=p.get('learning_rate', 0.05),
            random_state=42
        )
    raise ValueError(f"Tipo modello sconosciuto: {model_type}")


# ═══════════════════════════════════════════════════════════════
# [PROPOSTA 4] HELPER: OOF predictions + Ridge meta-learner
# ═══════════════════════════════════════════════════════════════
def _compute_stack_meta(X_all, X_pruned, yc, yo, sample_weights, rf_p, xgb_p, hgb_p, kf):
    """
    Calcola le Out-of-Fold predictions dei 3 modelli L1 e addestra
    un Ridge meta-regressore (con pesi positivi) come L2.
    Ritorna: (meta_c, meta_o, oof_data)
    """
    n = len(yc)
    oof_rf_c  = np.zeros(n); oof_xgb_c = np.zeros(n); oof_hgb_c = np.zeros(n)
    oof_rf_o  = np.zeros(n); oof_xgb_o = np.zeros(n); oof_hgb_o = np.zeros(n)

    for tr, te in kf.split(X_pruned):
        sw_tr = sample_weights[tr]
        rf_c  = build_model('rf',  rf_p).fit(X_all.iloc[tr],    yc.iloc[tr], sample_weight=sw_tr)
        xgb_c = build_model('xgb', xgb_p).fit(X_pruned.iloc[tr], yc.iloc[tr], sample_weight=sw_tr)
        hgb_c = build_model('hgb', hgb_p).fit(X_pruned.iloc[tr], yc.iloc[tr], sample_weight=sw_tr)
        rf_o  = build_model('rf',  rf_p).fit(X_all.iloc[tr],    yo.iloc[tr], sample_weight=sw_tr)
        xgb_o = build_model('xgb', xgb_p).fit(X_pruned.iloc[tr], yo.iloc[tr], sample_weight=sw_tr)
        hgb_o = build_model('hgb', hgb_p).fit(X_pruned.iloc[tr], yo.iloc[tr], sample_weight=sw_tr)

        oof_rf_c[te]  = rf_c.predict(X_all.iloc[te])
        oof_xgb_c[te] = xgb_c.predict(X_pruned.iloc[te])
        oof_hgb_c[te] = hgb_c.predict(X_pruned.iloc[te])
        oof_rf_o[te]  = rf_o.predict(X_all.iloc[te])
        oof_xgb_o[te] = xgb_o.predict(X_pruned.iloc[te])
        oof_hgb_o[te] = hgb_o.predict(X_pruned.iloc[te])

    meta_X_c = np.column_stack([oof_rf_c, oof_xgb_c, oof_hgb_c])
    meta_X_o = np.column_stack([oof_rf_o, oof_xgb_o, oof_hgb_o])

    # Ridge con positive=True: pesi non negativi. fit_intercept=False: puri blend ratios.
    meta_c = Ridge(alpha=1.0, positive=True, fit_intercept=False).fit(
        meta_X_c, yc.values, sample_weight=sample_weights)
    meta_o = Ridge(alpha=1.0, positive=True, fit_intercept=False).fit(
        meta_X_o, yo.values, sample_weight=sample_weights)

    # MAE pesato sulle OOF predictions
    mae_c = mean_absolute_error(yc, meta_c.predict(meta_X_c), sample_weight=sample_weights)
    mae_o = mean_absolute_error(yo, meta_o.predict(meta_X_o), sample_weight=sample_weights)
    mae   = (mae_c + mae_o) / 2

    oof_data = {
        'rf_c': oof_rf_c, 'xgb_c': oof_xgb_c, 'hgb_c': oof_hgb_c,
        'rf_o': oof_rf_o, 'xgb_o': oof_xgb_o, 'hgb_o': oof_hgb_o,
    }
    return meta_c, meta_o, mae, oof_data


# ═══════════════════════════════════════════════════════════════
# OPTUNA TUNING
# ═══════════════════════════════════════════════════════════════
def optuna_tune(ml_df, n_trials=N_OPTUNA_TRIALS, sample_weights=None):
    print(f"\n{'='*60}")
    print(f" OPTUNA TUNING ({n_trials} trial per modello, 3 modelli per statistica)")
    print(f"{'='*60}")
    kf = KFold(n_splits=5, shuffle=True, random_state=42)

    best_params = {}
    if os.path.exists(BEST_PARAMS_PATH):
        try:
            with open(BEST_PARAMS_PATH) as f:
                best_params = json.load(f)
        except: pass

    selected_features_dict = {}
    if os.path.exists(SELECTED_FEATURES_PATH):
        try:
            with open(SELECTED_FEATURES_PATH, 'r') as f:
                selected_features_dict = json.load(f)
        except: pass

    for stat in STATS:
        print(f"\n> Tuning {stat.upper()}...")
        fcols = get_feature_cols(stat)
        if stat in selected_features_dict:
            fcols = [f for f in fcols if f in selected_features_dict[stat]]

        X  = ml_df[fcols].fillna(0)
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        stat_params = {}
        for mt in ['rf', 'xgb', 'hgb']:
            def objective(trial, _mt=mt):
                if _mt == 'rf':
                    p = {'n_estimators':     trial.suggest_int('n_estimators', 50, 500),
                         'max_depth':        trial.suggest_int('max_depth', 3, 10),
                         'min_samples_leaf': trial.suggest_int('min_samples_leaf', 1, 20)}
                elif _mt == 'xgb':
                    p = {'n_estimators':     trial.suggest_int('n_estimators', 50, 500),
                         'max_depth':        trial.suggest_int('max_depth', 3, 8),
                         'learning_rate':    trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
                         'subsample':        trial.suggest_float('subsample', 0.6, 1.0),
                         'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0)}
                else:
                    p = {'max_iter':         trial.suggest_int('max_iter', 100, 500),
                         'max_depth':        trial.suggest_int('max_depth', 3, 8),
                         'min_samples_leaf': trial.suggest_int('min_samples_leaf', 5, 50),
                         'learning_rate':    trial.suggest_float('learning_rate', 0.01, 0.3, log=True)}

                maes = []
                for tr, te in kf.split(X):
                    sw_tr = sample_weights[tr] if sample_weights is not None else None
                    sw_te = sample_weights[te] if sample_weights is not None else None
                    mc = build_model(_mt, p).fit(X.iloc[tr], yc.iloc[tr], sample_weight=sw_tr)
                    mo = build_model(_mt, p).fit(X.iloc[tr], yo.iloc[tr], sample_weight=sw_tr)
                    maes.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te]), sample_weight=sw_te) +
                                  mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]), sample_weight=sw_te)) / 2)
                return float(np.mean(maes))

            study = optuna.create_study(direction='minimize')
            study.optimize(objective, n_trials=n_trials)
            stat_params[mt] = study.best_params
            print(f"  [{mt.upper()}] MAE: {study.best_value:.3f}")

        best_params[stat] = stat_params

    os.makedirs(MODELS_DIR, exist_ok=True)
    with open(BEST_PARAMS_PATH, 'w') as f:
        json.dump(best_params, f, indent=2)
    print(f"\n[OK] Tutti i parametri salvati -> {BEST_PARAMS_PATH}")
    return best_params


# ═══════════════════════════════════════════════════════════════
# SHAP FEATURE SELECTION
# ═══════════════════════════════════════════════════════════════
def run_shap_selection(ml_df):
    print("\n" + "="*60)
    print(" ESECUZIONE SHAP FEATURE SELECTION")
    print("="*60)

    os.makedirs(MODELS_DIR, exist_ok=True)
    selected_features = {}
    all_reports = {}

    for stat in STATS:
        print(f"\n> Analisi SHAP per {stat.upper()}...")
        features = get_feature_cols(stat)

        missing_f = [f for f in features if f not in ml_df.columns]
        if missing_f:
            features = [f for f in features if f in ml_df.columns]

        X  = ml_df[features].fillna(0)
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        model_c = xgb.XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, random_state=42, n_jobs=-1, verbosity=0)
        model_o = xgb.XGBRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, random_state=42, n_jobs=-1, verbosity=0)
        model_c.fit(X, yc)
        model_o.fit(X, yo)

        explainer_c = shap.TreeExplainer(model_c)
        shap_values_c = explainer_c.shap_values(X)
        mean_shap_c = np.abs(shap_values_c).mean(axis=0)

        explainer_o = shap.TreeExplainer(model_o)
        shap_values_o = explainer_o.shap_values(X)
        mean_shap_o = np.abs(shap_values_o).mean(axis=0)

        combined_importance = (mean_shap_c + mean_shap_o) / 2
        feat_imp = pd.DataFrame({'feature': features, 'importance': combined_importance})
        total_imp = feat_imp['importance'].sum()
        feat_imp['percentage']  = (feat_imp['importance'] / total_imp) * 100
        feat_imp['cumulative']  = feat_imp['percentage'].cumsum()
        feat_imp = feat_imp.sort_values(by='importance', ascending=False)
        all_reports[stat] = feat_imp

        cumsum = 0
        pruned_features = []
        for _, r in feat_imp.iterrows():
            pruned_features.append(r['feature'])
            cumsum += r['percentage']
            if cumsum >= 90.0:
                break

        selected_features[stat]              = features       # RF: tutte
        selected_features[f"{stat}_pruned"]  = pruned_features  # XGB/HGB: pruned 90%

        print(f"  RF: tutte le {len(features)} feature")
        print(f"  XGB/HGB: top {len(pruned_features)} feature (90% importanza cumulativa)")
        print(f"  Top 3: {', '.join(pruned_features[:3])}")

    with open(SELECTED_FEATURES_PATH, 'w') as f:
        json.dump(selected_features, f, indent=2)

    report_path = os.path.join(MODELS_DIR, 'SHAP_REPORT.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("# SHAP Feature Selection Report\n\n")
        f.write("RF usa tutte le feature. XGB e HGB usano le feature con importanza cumulativa >= 90%.\n\n")
        for stat in STATS:
            all_feats = selected_features[stat]
            pruned    = selected_features[f"{stat}_pruned"]
            f.write(f"## {stat.upper()} (RF: {len(all_feats)} feat | XGB/HGB: {len(pruned)} feat)\n")
            f.write("| Rank | Feature | Importanza | % | Cum% | XGB/HGB |\n")
            f.write("|---|---|---|---|---|---|\n")
            df_rep = all_reports[stat]
            for i, row in enumerate(df_rep.itertuples(), 1):
                in_pruned = "✅" if row.feature in pruned else "❌"
                f.write(f"| {i} | `{row.feature}` | {row.importance:.4f} | {row.percentage:.1f}% | {row.cumulative:.1f}% | {in_pruned} |\n")
            f.write("\n")

    print(f"\n[OK] Feature selection completata. Salvate in {SELECTED_FEATURES_PATH}")
    print(f"[OK] Generato Report Markdown: {report_path}")


# ═══════════════════════════════════════════════════════════════
# OPTUNA TUNING VARIANZA
# ═══════════════════════════════════════════════════════════════
def tune_variance_xgboost(X, var_yc, var_yo, sample_weights, n_trials=20):
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    def objective(trial):
        p = {
            'n_estimators':  trial.suggest_int('n_estimators', 50, 300),
            'max_depth':     trial.suggest_int('max_depth', 2, 6),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.2, log=True),
            'subsample':     trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0)
        }
        maes = []
        for tr, te in kf.split(X):
            sw_tr = sample_weights[tr]
            sw_te = sample_weights[te]
            mc = xgb.XGBRegressor(**p, random_state=42, verbosity=0).fit(X.iloc[tr], var_yc.iloc[tr], sample_weight=sw_tr)
            mo = xgb.XGBRegressor(**p, random_state=42, verbosity=0).fit(X.iloc[tr], var_yo.iloc[tr], sample_weight=sw_tr)
            maes.append((mean_absolute_error(var_yc.iloc[te], mc.predict(X.iloc[te]), sample_weight=sw_te) +
                          mean_absolute_error(var_yo.iloc[te], mo.predict(X.iloc[te]), sample_weight=sw_te)) / 2)
        return float(np.mean(maes))

    study = optuna.create_study(direction='minimize')
    study.optimize(objective, n_trials=n_trials)
    return study.best_params


# ═══════════════════════════════════════════════════════════════
# CHAMPION VS CHALLENGER
# ═══════════════════════════════════════════════════════════════
def champion_vs_challenger(stat, chal_mae_cv, metrics):
    champ_path = os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib')
    if not os.path.exists(champ_path):
        return True, 0.0
    if stat not in metrics or 'mae' not in metrics[stat] or metrics[stat]['mae'] == 0:
        return True, 0.0

    mae_champ_cv = metrics[stat]['mae']
    better = round(chal_mae_cv, 4) < round(mae_champ_cv, 4)
    return better, mae_champ_cv


def champion_vs_challenger_variance(ml_df, challenger_models, target_var_c, target_var_o, stat,
                                     sample_weights, X_override=None):
    champ_path_c = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_casa.joblib')
    champ_path_o = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_ospite.joblib')

    X      = X_override if X_override is not None else ml_df[get_feature_cols(stat)].fillna(0)
    vc, vo = target_var_c, target_var_o
    chal_c, chal_o = challenger_models

    mae_chal_glob = (mean_absolute_error(vc, chal_c.predict(X), sample_weight=sample_weights) +
                     mean_absolute_error(vo, chal_o.predict(X), sample_weight=sample_weights)) / 2

    if not os.path.exists(champ_path_c) or not os.path.exists(champ_path_o):
        return True, 0.0, mae_chal_glob

    try:
        champ_c = joblib.load(champ_path_c)
        champ_o = joblib.load(champ_path_o)
        try:
            X_c = X[champ_c.feature_names_in_] if hasattr(champ_c, 'feature_names_in_') else X
        except Exception:
            X_c = X
        try:
            X_o = X[champ_o.feature_names_in_] if hasattr(champ_o, 'feature_names_in_') else X
        except Exception:
            X_o = X
            
        mae_champ_glob = (mean_absolute_error(vc, champ_c.predict(X_c), sample_weight=sample_weights) +
                          mean_absolute_error(vo, champ_o.predict(X_o), sample_weight=sample_weights)) / 2
    except:
        return True, 0.0, mae_chal_glob

    return (mae_chal_glob < mae_champ_glob), mae_champ_glob, mae_chal_glob


# ═══════════════════════════════════════════════════════════════
# TRAINING PRINCIPALE
# ═══════════════════════════════════════════════════════════════
def train_and_save_models(db_path='resoconto.db', force_tune=False):
    start_time = time.time()
    df = load_data(db_path)

    # feature_engineering ritorna (DataFrame, sample_weights) [PROPOSTA 2]
    ml_df, sample_weights = feature_engineering(df)

    # Controlla se serve auto-trigger Optuna
    cur_count  = len(df)
    auto_tune  = False
    last_count = 0
    if os.path.exists(COUNT_PATH):
        with open(COUNT_PATH) as f:
            last_count = json.load(f).get('last_tune_count', 0)
    if force_tune or (cur_count - last_count >= TUNE_EVERY_N):
        auto_tune = True

    variance_best_params = {}
    if os.path.exists(VARIANCE_BEST_PARAMS_PATH):
        try:
            with open(VARIANCE_BEST_PARAMS_PATH) as f:
                variance_best_params = json.load(f)
        except: pass

    if auto_tune:
        reason = "--tune manuale" if force_tune else f"nuove partite ({cur_count - last_count} >= {TUNE_EVERY_N})"
        print(f"\n[~] Avvio Optuna ({reason})...")
        best_params = optuna_tune(ml_df, sample_weights=sample_weights)
        os.makedirs(MODELS_DIR, exist_ok=True)
        with open(COUNT_PATH, 'w') as f:
            json.dump({'last_tune_count': cur_count, 'timestamp': datetime.now().isoformat()}, f)
    else:
        if os.path.exists(BEST_PARAMS_PATH):
            with open(BEST_PARAMS_PATH) as f:
                best_params = json.load(f)
            print(f"[>] Usando parametri Optuna salvati ({BEST_PARAMS_PATH})")
        else:
            best_params = {}
            print("[>] Nessun parametro Optuna trovato — uso default + K-Fold race")

    os.makedirs(MODELS_DIR, exist_ok=True)
    kf = KFold(n_splits=5, shuffle=True, random_state=42)

    selected_features_dict = {}
    if os.path.exists(SELECTED_FEATURES_PATH):
        try:
            with open(SELECTED_FEATURES_PATH, 'r') as f:
                selected_features_dict = json.load(f)
            print(f"[INFO] Trovato file selected_features.json. Utilizzerò le feature filtrate (modalità 'Pruned').")
        except: pass

    metrics = {}
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, 'r') as f:
                metrics = json.load(f)
        except: pass

    print(f"\n{'='*60}")
    print(f" TRAINING MODELLI ({len(ml_df)} partite valide)")
    print(f"{'='*60}")

    for stat in STATS:
        print(f"\n[{stat.upper()}]")
        all_fcols = get_feature_cols(stat)

        rf_fcols      = all_fcols
        xgb_hgb_fcols = all_fcols
        if stat in selected_features_dict:
            rf_fcols = [f for f in all_fcols if f in ml_df.columns]
        if f"{stat}_pruned" in selected_features_dict:
            pruned = selected_features_dict[f"{stat}_pruned"]
            xgb_hgb_fcols = [f for f in all_fcols if f in pruned and f in ml_df.columns]

        X_pruned = ml_df[xgb_hgb_fcols].fillna(0)
        X_all    = ml_df[rf_fcols].fillna(0)
        current_n_features = len(xgb_hgb_fcols)

        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        # --- SUPER CHALLENGER RACE (RF + XGB + HGB + STACK) ---
        race_results = {}
        can_stack = (best_params and stat in best_params and
                     all(m in best_params[stat] for m in ['rf', 'xgb', 'hgb']))
        algo_list = ['rf', 'xgb', 'hgb'] + (['stack'] if can_stack else [])

        for mt in algo_list:
            if mt == 'stack':
                # [PROPOSTA 4] Ridge meta-learner tramite Out-of-Fold stacking
                rf_p  = best_params.get(stat, {}).get('rf',  {})
                xgb_p = best_params.get(stat, {}).get('xgb', {})
                hgb_p = best_params.get(stat, {}).get('hgb', {})

                meta_c, meta_o, mae_cv_final, oof_data = _compute_stack_meta(
                    X_all, X_pruned, yc, yo, sample_weights, rf_p, xgb_p, hgb_p, kf
                )
                # Log pesi Ridge appresi
                wc = meta_c.coef_
                print(f"  [STACK] Ridge pesi casa — RF:{wc[0]:.3f} XGB:{wc[1]:.3f} HGB:{wc[2]:.3f}")

                race_results['stack'] = {
                    'mae_cv': mae_cv_final,
                    'params': {},
                    'meta_c': meta_c,
                    'meta_o': meta_o,
                    'oof_data': oof_data,
                }
            else:
                X_for_algo = X_all if mt == 'rf' else X_pruned
                params = {}
                if stat in best_params and mt in best_params[stat]:
                    params = best_params[stat][mt]

                maes_cv = []
                for tr, te in kf.split(X_for_algo):
                    sw_tr = sample_weights[tr]
                    sw_te = sample_weights[te]
                    mc = build_model(mt, params).fit(X_for_algo.iloc[tr], yc.iloc[tr], sample_weight=sw_tr)
                    mo = build_model(mt, params).fit(X_for_algo.iloc[tr], yo.iloc[tr], sample_weight=sw_tr)
                    maes_cv.append(
                        (mean_absolute_error(yc.iloc[te], mc.predict(X_for_algo.iloc[te]), sample_weight=sw_te) +
                         mean_absolute_error(yo.iloc[te], mo.predict(X_for_algo.iloc[te]), sample_weight=sw_te)) / 2
                    )
                mae_cv_final = float(np.mean(maes_cv))
                race_results[mt] = {'mae_cv': mae_cv_final, 'params': params,
                                    'x_type': 'all' if mt == 'rf' else 'pruned'}

        # Vincitore basato su CV MAE pesato (Generalizzazione su match recenti)
        mt_winner    = min(race_results, key=lambda k: race_results[k]['mae_cv'])
        params_winner = race_results[mt_winner]['params']
        m_chal_cv    = race_results[mt_winner]['mae_cv']

        # Addestra il miglior Challenger sul set completo
        if mt_winner == 'stack':
            rf_p  = best_params.get(stat, {}).get('rf',  {})
            xgb_p = best_params.get(stat, {}).get('xgb', {})
            hgb_p = best_params.get(stat, {}).get('hgb', {})

            rf_c_model  = build_model('rf',  rf_p ).fit(X_all,    yc, sample_weight=sample_weights)
            xgb_c_model = build_model('xgb', xgb_p).fit(X_pruned, yc, sample_weight=sample_weights)
            hgb_c_model = build_model('hgb', hgb_p).fit(X_pruned, yc, sample_weight=sample_weights)
            rf_o_model  = build_model('rf',  rf_p ).fit(X_all,    yo, sample_weight=sample_weights)
            xgb_o_model = build_model('xgb', xgb_p).fit(X_pruned, yo, sample_weight=sample_weights)
            hgb_o_model = build_model('hgb', hgb_p).fit(X_pruned, yo, sample_weight=sample_weights)

            # Riutilizza il Ridge dalla gara (già ottimizzato sulle OOF)
            meta_c_final = race_results['stack']['meta_c']
            meta_o_final = race_results['stack']['meta_o']

            joblib.dump({
                'rf': rf_c_model, 'xgb': xgb_c_model, 'hgb': hgb_c_model,
                'meta': meta_c_final,
                'x_all_cols': rf_fcols, 'x_pruned_cols': xgb_hgb_fcols
            }, os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib'))
            joblib.dump({
                'rf': rf_o_model, 'xgb': xgb_o_model, 'hgb': hgb_o_model,
                'meta': meta_o_final,
                'x_all_cols': rf_fcols, 'x_pruned_cols': xgb_hgb_fcols
            }, os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib'))
            chal_c_final = None
            chal_o_final = None
        else:
            X_for_winner = X_all if mt_winner == 'rf' else X_pruned
            chal_c_final = build_model(mt_winner, params_winner).fit(X_for_winner, yc, sample_weight=sample_weights)
            chal_o_final = build_model(mt_winner, params_winner).fit(X_for_winner, yo, sample_weight=sample_weights)

        stack_str = f" | STACK:{race_results['stack']['mae_cv']:.3f}" if can_stack else ""
        print(f"  Sfida a {len(algo_list)} (CV MAE pesato): RF:{race_results['rf']['mae_cv']:.3f} | XGB:{race_results['xgb']['mae_cv']:.3f} | HGB:{race_results['hgb']['mae_cv']:.3f}{stack_str}")
        print(f"  >> Challenger scelto: {mt_winner.upper()} (Global CV MAE: {m_chal_cv:.4f})")

        # Champion vs Challenger
        champ_n_features    = metrics.get(stat, {}).get('n_features', 0)
        feature_set_changed = (champ_n_features != 0 and champ_n_features != current_n_features)

        print(f"  Confronto con Champion attuale (Global CV MAE):")
        challenger_wins, m_champ_cv = champion_vs_challenger(stat, m_chal_cv, metrics)

        if feature_set_changed:
            challenger_wins = True
            print(f"  [!!] Feature set cambiato ({champ_n_features} -> {current_n_features}): Challenger forzato a vincere")

        X_winner = X_pruned if mt_winner != 'rf' else X_all

        if challenger_wins:
            icon = "[OK]" if m_champ_cv > 0 else "[NEW]"
            print(f"  {icon} CV MAE: Champ {m_champ_cv:.4f} vs Chal {m_chal_cv:.4f} >> CHALLENGER VINCE")

            if mt_winner != 'stack':
                joblib.dump(chal_c_final, os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib'))
                joblib.dump(chal_o_final, os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib'))

            if mt_winner == 'stack':
                active_c_final = None
                active_o_final = None
            else:
                active_c_final = chal_c_final
                active_o_final = chal_o_final

            metrics[stat] = {
                'model_type':  mt_winner,
                'mae':         round(m_chal_cv, 4),
                'champion_updated': True,
                'trained_at':  datetime.now().isoformat(),
                'n_samples':   len(ml_df),
                'n_features':  current_n_features,
                'variance_mae': metrics.get(stat, {}).get('variance_mae', 0.0),
                'variance_model_type': metrics.get(stat, {}).get('variance_model_type', 'xgb'),
                'variance_trained_at': metrics.get(stat, {}).get('variance_trained_at', datetime.now().isoformat())
            }
        else:
            print(f"  [--] CV MAE: Champ {m_champ_cv:.4f} vs Chal {m_chal_cv:.4f} >> CHAMPION RIMANE")
            loaded = joblib.load(os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib'))
            if isinstance(loaded, dict):
                active_c_final = None
                active_o_final = None
            else:
                active_c_final = loaded
                active_o_final = joblib.load(os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib'))

            if stat in metrics:
                metrics[stat]['champion_updated'] = False
                metrics[stat]['n_samples']  = len(ml_df)
                metrics[stat]['n_features'] = current_n_features
            else:
                metrics[stat] = {
                    'model_type': mt_winner,
                    'mae': round(m_chal_cv, 4),
                    'champion_updated': False,
                    'trained_at': datetime.now().isoformat(),
                    'n_samples': len(ml_df),
                    'n_features': current_n_features,
                    'variance_mae': 0.0,
                    'variance_model_type': 'xgb',
                    'variance_trained_at': datetime.now().isoformat()
                }

        # ===== MODEL B: Variance Predictor =====
        print(f"  Training Variance Predictor for {stat}...")

        if active_c_final is None:
            loaded_c = joblib.load(os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib'))
            loaded_o = joblib.load(os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib'))
            if isinstance(loaded_c, dict):
                X_all_var    = ml_df[loaded_c['x_all_cols']].fillna(0)
                X_pruned_var = ml_df[loaded_c['x_pruned_cols']].fillna(0)
                if 'meta' in loaded_c:
                    # [PROPOSTA 4] Stack con Ridge meta-learner
                    pred_c_L1 = np.column_stack([
                        loaded_c['rf'].predict(X_all_var),
                        loaded_c['xgb'].predict(X_pruned_var),
                        loaded_c['hgb'].predict(X_pruned_var)
                    ])
                    pred_o_L1 = np.column_stack([
                        loaded_o['rf'].predict(X_all_var),
                        loaded_o['xgb'].predict(X_pruned_var),
                        loaded_o['hgb'].predict(X_pruned_var)
                    ])
                    pred_c = loaded_c['meta'].predict(pred_c_L1)
                    pred_o = loaded_o['meta'].predict(pred_o_L1)
                else:
                    pred_c = (loaded_c['rf'].predict(X_all_var) + loaded_c['xgb'].predict(X_pruned_var) + loaded_c['hgb'].predict(X_pruned_var)) / 3
                    pred_o = (loaded_o['rf'].predict(X_all_var) + loaded_o['xgb'].predict(X_pruned_var) + loaded_o['hgb'].predict(X_pruned_var)) / 3
                X_var = X_pruned_var
            else:
                if not challenger_wins:
                    champ_type = metrics.get(stat, {}).get('model_type', 'xgb')
                    X_champ = X_all if champ_type == 'rf' else X_pruned
                    try:
                        X_c = X_all[loaded_c.feature_names_in_] if hasattr(loaded_c, 'feature_names_in_') else X_champ
                        pred_c = loaded_c.predict(X_c)
                    except Exception as e:
                        print(f"  [!] Fallito predict champion casa: {e}")
                        pred_c = np.zeros(len(X_champ))

                    try:
                        X_o = X_all[loaded_o.feature_names_in_] if hasattr(loaded_o, 'feature_names_in_') else X_champ
                        pred_o = loaded_o.predict(X_o)
                    except Exception as e:
                        print(f"  [!] Fallito predict champion ospite: {e}")
                        pred_o = np.zeros(len(X_champ))
                    X_var  = X_champ
                else:
                    try:
                        X_c = X_all[loaded_c.feature_names_in_] if hasattr(loaded_c, 'feature_names_in_') else X_winner
                        pred_c = loaded_c.predict(X_c)
                    except Exception:
                        pred_c = np.zeros(len(X_winner))
                    try:
                        X_o = X_all[loaded_o.feature_names_in_] if hasattr(loaded_o, 'feature_names_in_') else X_winner
                        pred_o = loaded_o.predict(X_o)
                    except Exception:
                        pred_o = np.zeros(len(X_winner))
                    X_var  = X_winner
        else:
            if not challenger_wins:
                champ_type = metrics.get(stat, {}).get('model_type', 'xgb')
                X_champ = X_all if champ_type == 'rf' else X_pruned
                pred_c = active_c_final.predict(X_champ)
                pred_o = active_o_final.predict(X_champ)
                X_var  = X_champ
            else:
                pred_c = active_c_final.predict(X_winner)
                pred_o = active_o_final.predict(X_winner)
                X_var  = X_winner

        var_yc = pd.Series((yc.values - pred_c) ** 2, index=yc.index)
        var_yo = pd.Series((yo.values - pred_o) ** 2, index=yo.index)

        if auto_tune:
            print(f"    [Tuning] Cerco i migliori parametri per la Varianza ({stat})...")
            best_var_p = tune_variance_xgboost(X_var, var_yc, var_yo, sample_weights, n_trials=15)
            variance_best_params[stat] = best_var_p
            os.makedirs(VARIANCE_MODELS_DIR, exist_ok=True)
            with open(VARIANCE_BEST_PARAMS_PATH, 'w') as f:
                json.dump(variance_best_params, f, indent=2)
            var_params = best_var_p.copy()
        else:
            var_params = variance_best_params.get(stat, {'n_estimators': 100, 'max_depth': 4, 'learning_rate': 0.05}).copy()

        var_params['random_state'] = 42
        if 'verbosity' not in var_params:
            var_params['verbosity'] = 0

        v_chal_c = xgb.XGBRegressor(**var_params).fit(X_var, var_yc, sample_weight=sample_weights)
        v_chal_o = xgb.XGBRegressor(**var_params).fit(X_var, var_yo, sample_weight=sample_weights)

        v_wins, v_champ_glob, v_chal_glob = champion_vs_challenger_variance(
            ml_df, (v_chal_c, v_chal_o), var_yc, var_yo, stat, sample_weights, X_override=X_var
        )

        if challenger_wins:
            v_wins = True

        if v_wins:
            v_icon = "[OK]" if v_champ_glob > 0 else "[NEW]"
            print(f"  {v_icon} Var Global MAE: Champ {v_champ_glob:.4f} vs Chal {v_chal_glob:.4f} >> AGGIORNATO")
            os.makedirs(VARIANCE_MODELS_DIR, exist_ok=True)
            joblib.dump(v_chal_c, os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_casa.joblib'))
            joblib.dump(v_chal_o, os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_ospite.joblib'))
            metrics[stat]['variance_mae']     = round(v_chal_glob, 4)
            metrics[stat]['variance_updated'] = True
        else:
            print(f"  [--] Var Global MAE: Champ {v_champ_glob:.4f} vs Chal {v_chal_glob:.4f} >> INVARIATO")
            metrics[stat]['variance_updated'] = False
            metrics[stat]['variance_mae']     = round(v_champ_glob, 4)

        metrics[stat]['variance_model_type'] = 'xgb'
        metrics[stat]['variance_trained_at'] = datetime.now().isoformat()

    # Salva metrics
    with open(METRICS_PATH, 'w') as f:
        json.dump(metrics, f, indent=2)

    variance_metrics = {}
    for stat in STATS:
        if stat in metrics and 'variance_mae' in metrics[stat]:
            variance_metrics[stat] = {
                'variance_model_type': metrics[stat]['variance_model_type'],
                'variance_mae':        metrics[stat]['variance_mae'],
                'variance_trained_at': metrics[stat]['variance_trained_at']
            }
    with open(VARIANCE_METRICS_PATH, 'w') as f:
        json.dump(variance_metrics, f, indent=2)

    print(f"\n{'='*80}")
    print(f" {'STATISTICA':12s} | {'MOD':5s} | {'MAE (CV pesato)':16s} | {'VAR MAE':7s} | {'STATUS'}")
    print(f"{'='*80}")
    for s, m in metrics.items():
        m_upd  = "MOD" if m['champion_updated'] else ""
        v_upd  = "VAR" if m.get('variance_updated', False) else ""
        status = f"{m_upd} {v_upd}".strip() or "[--]"
        print(f"  {s.upper():12s} | {m['model_type'].upper():5s} | {m['mae']:.3f}            | {m.get('variance_mae', 0):.3f}   | {status}")
    print(f"\n[OK] Completato. Metriche -> {METRICS_PATH}")
    print(f"[OK] Variance Metriche -> {VARIANCE_METRICS_PATH}")

    elapsed = time.time() - start_time
    mins, secs = divmod(elapsed, 60)
    print(f"\n[TIME] Tempo totale di esecuzione: {int(mins)} minuti e {int(secs)} secondi")


# ═══════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='ML Training Pipeline v2.0')
    parser.add_argument('--tune',  action='store_true',
                        help='Forza Optuna hyperparameter tuning (lento, ~5-10 min)')
    parser.add_argument('--shap',  action='store_true',
                        help='Esegue la feature selection con SHAP e salva le migliori')
    parser.add_argument('--db',    default='resoconto.db',
                        help='Path al database SQLite')
    args = parser.parse_args()

    if args.shap:
        df = load_data(args.db)
        ml_df, _ = feature_engineering(df)   # _ = sample_weights (non necessario per SHAP)
        if len(ml_df) == 0:
            print("[ERROR] Nessuna partita con dati SofaScore disponibile. Il SHAP non può partire.")
        else:
            run_shap_selection(ml_df)
    else:
        train_and_save_models(db_path=args.db, force_tune=args.tune)
