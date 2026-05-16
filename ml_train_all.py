import sqlite3
import pandas as pd
import numpy as np
import os
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
import libsql_client as libsql
optuna.logging.set_verbosity(optuna.logging.WARNING)
warnings.filterwarnings('ignore')

# ?????????????????????????????????????????????????????????????
# COSTANTI
# ?????????????????????????????????????????????????????????????
STATS = ['gol', 'tiri', 'tip', 'falli', 'corner', 'cartellini', 'parate']

# Soglie Over/Under per il calcolo delle Hit Rates (stile Excel)
# Per ogni statistica, le 3 linee di scommessa più comuni
HIT_RATE_THRESHOLDS = {
    'gol':        [0.5, 1.5, 2.5],
    'tiri':       [8.5, 10.5, 12.5],
    'tip':        [2.5, 4.5, 6.5],
    'falli':      [10.5, 12.5, 14.5],
    'corner':     [3.5, 4.5, 5.5],
    'cartellini': [1.5, 2.5, 3.5],
    'parate':     [1.5, 2.5, 3.5],
}
# Directory per i modelli (percorsi assoluti per evitare errori se chiamato da altre cartelle)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, 'models')
METRICS_PATH    = os.path.join(MODELS_DIR, 'metrics.json')
BEST_PARAMS_PATH = os.path.join(MODELS_DIR, 'best_params.json')
COUNT_PATH      = os.path.join(MODELS_DIR, 'match_count.json')
TUNE_EVERY_N    = 50   # trigger automatico Optuna ogni N nuove partite
N_OPTUNA_TRIALS = 30   # trial per statistica (60 non migliorava il MAE, solo raddoppiava il tempo)

# Directory for variance models
VARIANCE_MODELS_DIR = os.path.join(MODELS_DIR, 'variance')
VARIANCE_METRICS_PATH = os.path.join(VARIANCE_MODELS_DIR, 'variance_metrics.json')
VARIANCE_BEST_PARAMS_PATH = os.path.join(VARIANCE_MODELS_DIR, 'variance_best_params.json')

# ?????????????????????????????????????????????????????????????
# HELPER: LETTURA STATISTICA DA RIGA
# ?????????????????????????????????????????????????????????????
def get_stat(row, stat, is_home):
    mapping = {
        'gol':        ('home_goals',   'away_goals'),
        'tiri':       ('home_shots',   'away_shots'),
        'tip':        ('home_sot',     'away_sot'),
        'falli':      ('home_fouls',   'away_fouls'),
        'corner':     ('home_corners', 'away_corners'),
    }
    if stat in mapping:
        col = mapping[stat][0] if is_home else mapping[stat][1]
        return float(row.get(col, 0) or 0)
    if stat == 'cartellini':
        y_col = 'home_yellows' if is_home else 'away_yellows'
        r_col = 'home_reds'    if is_home else 'away_reds'
        return float((row.get(y_col, 0) or 0) + (row.get(r_col, 0) or 0) * 2)
    if stat == 'parate':
        tip_sub = row.get('away_sot' if is_home else 'home_sot', 0) or 0
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

# ?????????????????????????????????????????????????????????????
# COLONNE FEATURE ? usate sia in training che in predict
# ?????????????????????????????????????????????????????????????
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
    if stat in ('falli', 'cartellini'):
        cols.append(f'f_{stat}_ref')

    # --- NUOVE FEATURE: Hit Rates, Deviazione Standard, Mediana ---
    thresholds = HIT_RATE_THRESHOLDS[stat]
    for side in ('h', 'a'):
        for i in range(1, len(thresholds) + 1):
            # Hit Rate Fatti Globale (ultime 10, casa+trasf)
            cols.append(f'f_{stat}_{side}_for_hr{i}')
            # Hit Rate Subiti Globale (ultime 10, casa+trasf)
            cols.append(f'f_{stat}_{side}_ag_hr{i}')
            # Hit Rate Fatti Specifico (home_for per 'h', away_for per 'a')
            cols.append(f'f_{stat}_{side}_spec_for_hr{i}')
            # Hit Rate Subiti Specifico (home_ag per 'h', away_ag per 'a')
            cols.append(f'f_{stat}_{side}_spec_ag_hr{i}')
        # Deviazione Standard (consistenza, ultime 10)
        cols.append(f'f_{stat}_{side}_for_std')
        cols.append(f'f_{stat}_{side}_ag_std')
        # Mediana (robusta agli outlier, ultime 10)
        cols.append(f'f_{stat}_{side}_for_med')
        cols.append(f'f_{stat}_{side}_ag_med')

    return cols

# ?????????????????????????????????????????????????????????????
# CARICAMENTO DATI
# ?????????????????????????????????????????????????????????????
def load_data(db_path='resoconto.db'):
    # Caricamento variabili d'ambiente dal file .env.local
    env = {}
    if os.path.exists('.env.local'):
        with open('.env.local', 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    env[k] = v.strip().strip('"')
    
    url = env.get('TURSO_DATABASE_URL')
    token = env.get('TURSO_AUTH_TOKEN')
    
    if url and token:
        print(f"[DB] Connessione a Turso in corso...")
        client = libsql.create_client_sync(url, auth_token=token)
        res = client.execute("SELECT * FROM matches ORDER BY date ASC")
        df = pd.DataFrame(res.rows, columns=res.columns)
        client.close()
    else:
        print(f"[DB] Connessione al database locale ({db_path})...")
        conn = sqlite3.connect(db_path, timeout=30)
        df = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
        conn.close()
        
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).sort_values('date').reset_index(drop=True)
    return df

# ?????????????????????????????????????????????????????????????
# FEATURE ENGINEERING AVANZATA
# ?????????????????????????????????????????????????????????????
def feature_engineering(df):
    print(f"Creando feature avanzate su {len(df)} partite...")
    features = []
    team_hist = {}   # team -> stat -> {for_all, ag_all, home_for, home_ag, away_for, away_ag}
    ref_hist  = {}   # ref  -> stat -> [values]

    for _, row in df.iterrows():
        home = row['home_team']
        away = row['away_team']
        ref  = str(row.get('referee', '') or '')

        # Inizializza strutture se mancanti
        for team in (home, away):
            if team not in team_hist:
                team_hist[team] = {
                    s: {'for_all': [], 'ag_all': [],
                        'home_for': [], 'home_ag': [],
                        'away_for': [], 'away_ag': []}
                    for s in STATS
                }
        if ref not in ref_hist:
            ref_hist[ref] = {s: [] for s in STATS}

        # Richiedi almeno 3 partite per entrambe le squadre
        if (len(team_hist[home]['gol']['for_all']) < 3 or
                len(team_hist[away]['gol']['for_all']) < 3):
            # Aggiorna storia e vai avanti senza aggiungere riga
            for s in STATS:
                hv = get_stat(row, s, True)
                av = get_stat(row, s, False)
                _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av)
            continue

        row_feat = {}
        for s in STATS:
            h = team_hist[home][s]
            a = team_hist[away][s]

            # Home team rolling
            row_feat[f'f_{s}_h_for3']  = _avg(h['for_all'], 3)
            row_feat[f'f_{s}_h_for5']  = _avg(h['for_all'], 5)
            row_feat[f'f_{s}_h_for10'] = _avg(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag3']   = _avg(h['ag_all'],  3)
            row_feat[f'f_{s}_h_ag5']   = _avg(h['ag_all'],  5)
            row_feat[f'f_{s}_h_ag10']  = _avg(h['ag_all'],  10)
            # Home-specific (fallback all se vuoto)
            row_feat[f'f_{s}_h_hfor'] = _avg(h['home_for'], 5) or row_feat[f'f_{s}_h_for5']
            row_feat[f'f_{s}_h_hag']  = _avg(h['home_ag'],  5) or row_feat[f'f_{s}_h_ag5']

            # Away team rolling
            row_feat[f'f_{s}_a_for3']  = _avg(a['for_all'], 3)
            row_feat[f'f_{s}_a_for5']  = _avg(a['for_all'], 5)
            row_feat[f'f_{s}_a_for10'] = _avg(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag3']   = _avg(a['ag_all'],  3)
            row_feat[f'f_{s}_a_ag5']   = _avg(a['ag_all'],  5)
            row_feat[f'f_{s}_a_ag10']  = _avg(a['ag_all'],  10)
            # Away-specific
            row_feat[f'f_{s}_a_afor'] = _avg(a['away_for'], 5) or row_feat[f'f_{s}_a_for5']
            row_feat[f'f_{s}_a_aag']  = _avg(a['away_ag'],  5) or row_feat[f'f_{s}_a_ag5']

            # Differenziali di forza
            row_feat[f'f_{s}_str_h'] = row_feat[f'f_{s}_h_for5'] - row_feat[f'f_{s}_a_ag5']
            row_feat[f'f_{s}_str_a'] = row_feat[f'f_{s}_a_for5'] - row_feat[f'f_{s}_h_ag5']

            # Arbitro (solo falli/cartellini)
            if s in ('falli', 'cartellini'):
                ref_vals = ref_hist[ref][s]
                fallback = row_feat[f'f_{s}_h_for5'] + row_feat[f'f_{s}_a_for5']
                row_feat[f'f_{s}_ref'] = _avg(ref_vals, 10) if ref_vals else fallback

            # --- NUOVE FEATURE: Hit Rates, Deviazione Standard, Mediana ---
            thresholds = HIT_RATE_THRESHOLDS[s]
            for i, thr in enumerate(thresholds, 1):
                # Home team
                row_feat[f'f_{s}_h_for_hr{i}']      = _hit_rate(h['for_all'],  10, thr)
                row_feat[f'f_{s}_h_ag_hr{i}']       = _hit_rate(h['ag_all'],   10, thr)
                row_feat[f'f_{s}_h_spec_for_hr{i}'] = _hit_rate(h['home_for'], 10, thr)
                row_feat[f'f_{s}_h_spec_ag_hr{i}']  = _hit_rate(h['home_ag'],  10, thr)
                # Away team
                row_feat[f'f_{s}_a_for_hr{i}']      = _hit_rate(a['for_all'],  10, thr)
                row_feat[f'f_{s}_a_ag_hr{i}']       = _hit_rate(a['ag_all'],   10, thr)
                row_feat[f'f_{s}_a_spec_for_hr{i}'] = _hit_rate(a['away_for'], 10, thr)
                row_feat[f'f_{s}_a_spec_ag_hr{i}']  = _hit_rate(a['away_ag'],  10, thr)
            # Deviazione Standard (ultime 10)
            row_feat[f'f_{s}_h_for_std'] = _std(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag_std']  = _std(h['ag_all'],  10)
            row_feat[f'f_{s}_a_for_std'] = _std(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag_std']  = _std(a['ag_all'],  10)
            # Mediana (ultime 10)
            row_feat[f'f_{s}_h_for_med'] = _median(h['for_all'], 10)
            row_feat[f'f_{s}_h_ag_med']  = _median(h['ag_all'],  10)
            row_feat[f'f_{s}_a_for_med'] = _median(a['for_all'], 10)
            row_feat[f'f_{s}_a_ag_med']  = _median(a['ag_all'],  10)

            # Target
            row_feat[f'target_{s}_casa']   = get_stat(row, s, True)
            row_feat[f'target_{s}_ospite'] = get_stat(row, s, False)

        features.append(row_feat)

        # Aggiorna storia
        for s in STATS:
            hv = get_stat(row, s, True)
            av = get_stat(row, s, False)
            _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av)

    result = pd.DataFrame(features).fillna(0)
    print(f"  >> {len(result)} partite valide per il training.")
    return result

def _update_hist(team_hist, ref_hist, home, away, ref, s, hv, av):
    team_hist[home][s]['for_all'].append(hv)
    team_hist[home][s]['ag_all'].append(av)
    team_hist[home][s]['home_for'].append(hv)
    team_hist[home][s]['home_ag'].append(av)
    team_hist[away][s]['for_all'].append(av)
    team_hist[away][s]['ag_all'].append(hv)
    team_hist[away][s]['away_for'].append(av)
    team_hist[away][s]['away_ag'].append(hv)
    ref_hist[ref][s].append(hv + av)

# ?????????????????????????????????????????????????????????????
# COSTRUZIONE MODELLO
# ?????????????????????????????????????????????????????????????
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
            objective='count:poisson',  # Distribuzione di Poisson: ideale per eventi di conteggio (gol, corner, ecc.)
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

# ?????????????????????????????????????????????????????????????
# VOTING ENSEMBLE (RF + XGB + HGB)
# ?????????????????????????????????????????????????????????????
def build_ensemble(best_params, stat):
    """
    Costruisce un VotingRegressor che combina RF, XGB e HGB con i loro
    migliori parametri Optuna. Restituisce la media delle loro previsioni,
    annullando i rispettivi punti deboli e sommando i punti di forza.
    """
    rf_p  = best_params.get(stat, {}).get('rf',  {})
    xgb_p = best_params.get(stat, {}).get('xgb', {})
    hgb_p = best_params.get(stat, {}).get('hgb', {})
    return VotingRegressor(
        estimators=[
            ('rf',  build_model('rf',  rf_p)),
            ('xgb', build_model('xgb', xgb_p)),
            ('hgb', build_model('hgb', hgb_p)),
        ],
        n_jobs=-1
    )

# ?????????????????????????????????????????????????????????????
# OPTUNA TUNING
# ?????????????????????????????????????????????????????????????
def optuna_tune(ml_df, n_trials=N_OPTUNA_TRIALS):
    print(f"\n{'='*60}")
    print(f" OPTUNA TUNING ({n_trials} trial per modello, 3 modelli per statistica)")
    print(f"{'='*60}")
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    
    # Carichiamo i parametri esistenti per non perdere quelli delle altre statistiche se interrotto
    best_params = {}
    if os.path.exists(BEST_PARAMS_PATH):
        try:
            with open(BEST_PARAMS_PATH) as f:
                best_params = json.load(f)
        except: pass

    for stat in STATS:
        print(f"\n> Tuning {stat.upper()}...")
        fcols = get_feature_cols(stat)
        X  = ml_df[fcols]
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']
        
        stat_params = {}

        for mt in ['rf', 'xgb', 'hgb']:
            def objective(trial):
                if mt == 'rf':
                    p = {'n_estimators':    trial.suggest_int('n_estimators', 50, 500),
                         'max_depth':       trial.suggest_int('max_depth', 3, 10),
                         'min_samples_leaf':trial.suggest_int('min_samples_leaf', 1, 20)}
                elif mt == 'xgb':
                    p = {'n_estimators':    trial.suggest_int('n_estimators', 50, 500),
                         'max_depth':       trial.suggest_int('max_depth', 3, 8),
                         'learning_rate':   trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
                         'subsample':       trial.suggest_float('subsample', 0.6, 1.0),
                         'colsample_bytree':trial.suggest_float('colsample_bytree', 0.6, 1.0)}
                else:
                    p = {'max_iter':        trial.suggest_int('max_iter', 100, 500),
                         'max_depth':       trial.suggest_int('max_depth', 3, 8),
                         'min_samples_leaf':trial.suggest_int('min_samples_leaf', 5, 50),
                         'learning_rate':   trial.suggest_float('learning_rate', 0.01, 0.3, log=True)}
                
                maes = []
                for tr, te in kf.split(X):
                    mc = build_model(mt, p).fit(X.iloc[tr], yc.iloc[tr])
                    mo = build_model(mt, p).fit(X.iloc[tr], yo.iloc[tr])
                    maes.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                                  mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
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

# ?????????????????????????????????????????????????????????????
# CHAMPION VS CHALLENGER
# ?????????????????????????????????????????????????????????????
def champion_vs_challenger(stat, chal_mae_cv, metrics):
    """
    Valuta champion vs challenger usando il MAE Globale (CV).
    Ritorna (better, mae_champ_cv).
    Se il file .joblib non esiste sul disco, il challenger vince (nessun champion reale).
    """
    # Verifica che il modello champion esista fisicamente su disco
    champ_path = os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib')
    if not os.path.exists(champ_path):
        return True, 0.0

    if stat not in metrics or 'mae' not in metrics[stat] or metrics[stat]['mae'] == 0:
        return True, 0.0

    mae_champ_cv = metrics[stat]['mae']

    # Vince chi ha il MAE Globale (CV) migliore (arrotondato per coerenza con il salvataggio)
    better = round(chal_mae_cv, 4) < round(mae_champ_cv, 4)
    return better, mae_champ_cv


def champion_vs_challenger_variance(ml_df, challenger_models, target_var_c, target_var_o, stat):
    """
    Simile a champion_vs_challenger ma per i modelli di varianza.
    Ora utilizza il MAE Globale sull'intero dataset per maggiore stabilità.
    Restituisce: (vince_challenger, mae_champ_glob, mae_chal_glob)
    """
    champ_path_c = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_casa.joblib')
    champ_path_o = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_ospite.joblib')

    X = ml_df[get_feature_cols(stat)]
    vc = target_var_c
    vo = target_var_o

    chal_c, chal_o = challenger_models
    
    mae_chal_glob = (mean_absolute_error(vc, chal_c.predict(X)) +
                     mean_absolute_error(vo, chal_o.predict(X))) / 2

    if not os.path.exists(champ_path_c) or not os.path.exists(champ_path_o):
        return True, 0.0, mae_chal_glob  # NEW

    try:
        champ_c = joblib.load(champ_path_c)
        champ_o = joblib.load(champ_path_o)
        
        mae_champ_glob = (mean_absolute_error(vc, champ_c.predict(X)) +
                          mean_absolute_error(vo, champ_o.predict(X))) / 2
    except:
        return True, 0.0, mae_chal_glob  # Champion incompatibile

    return (mae_chal_glob < mae_champ_glob), mae_champ_glob, mae_chal_glob

# ?????????????????????????????????????????????????????????????
# TRAINING PRINCIPALE
# ?????????????????????????????????????????????????????????????
def train_and_save_models(db_path='resoconto.db', force_tune=False):
    df    = load_data(db_path)
    ml_df = feature_engineering(df)

    # Controlla se serve auto-trigger Optuna
    cur_count    = len(df)
    auto_tune    = False
    last_count   = 0
    if os.path.exists(COUNT_PATH):
        with open(COUNT_PATH) as f:
            last_count = json.load(f).get('last_tune_count', 0)
    if force_tune or (cur_count - last_count >= TUNE_EVERY_N):
        auto_tune = True

    # Carica o calcola best_params
    if auto_tune:
        reason = "--tune manuale" if force_tune else f"nuove partite ({cur_count - last_count} >= {TUNE_EVERY_N})"
        print(f"\n[~] Avvio Optuna ({reason})...")
        best_params = optuna_tune(ml_df)
        # Salva contatore
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
            print("[>] Nessun parametro Optuna trovato ? uso default + K-Fold race")

    os.makedirs(MODELS_DIR, exist_ok=True)
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    
    # Carica le metriche esistenti per preservare i Champion che vincono
    metrics = {}
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, 'r') as f:
                metrics = json.load(f)
        except Exception:
            pass

    print(f"\n{'='*60}")
    print(f" TRAINING MODELLI ({len(ml_df)} partite valide)")
    print(f"{'='*60}")

    for stat in STATS:
        print(f"\n[{stat.upper()}]")
        fcols = get_feature_cols(stat)
        X  = ml_df[fcols]
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        # --- SUPER CHALLENGER RACE (3 modelli + VotingEnsemble) ---
        race_results = {}

        # Stack disponibile solo se Optuna ha i parametri per tutti e 3 gli algoritmi
        can_stack = (best_params and stat in best_params and
                     all(m in best_params[stat] for m in ['rf', 'xgb', 'hgb']))
        algo_list = ['rf', 'xgb', 'hgb'] + (['stack'] if can_stack else [])

        for mt in algo_list:
            if mt == 'stack':
                # VotingEnsemble: media di RF+XGB+HGB con i loro migliori parametri
                maes_cv = []
                for tr, te in kf.split(X):
                    mc = build_ensemble(best_params, stat).fit(X.iloc[tr], yc.iloc[tr])
                    mo = build_ensemble(best_params, stat).fit(X.iloc[tr], yo.iloc[tr])
                    maes_cv.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                                     mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
                mae_cv_final = float(np.mean(maes_cv))
                race_results['stack'] = {'mae_cv': mae_cv_final, 'params': {}}
            else:
                params = {}
                if stat in best_params and mt in best_params[stat]:
                    params = best_params[stat][mt]
                elif stat in best_params and 'model_type' in best_params[stat] and best_params[stat]['model_type'] == mt:
                    params = {k:v for k,v in best_params[stat].items() if k not in ('model_type','mae')}

                # 1. Calcolo MAE CV (Global) - Cruciale per la scelta
                maes_cv = []
                for tr, te in kf.split(X):
                    mc = build_model(mt, params).fit(X.iloc[tr], yc.iloc[tr])
                    mo = build_model(mt, params).fit(X.iloc[tr], yo.iloc[tr])
                    maes_cv.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                                     mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
                mae_cv_final = float(np.mean(maes_cv))

                race_results[mt] = {'mae_cv': mae_cv_final, 'params': params}
        
        # Vincitore basato su CV MAE (Generalizzazione)
        mt_winner = min(race_results, key=lambda k: race_results[k]['mae_cv'])
        params_winner = race_results[mt_winner]['params']
        m_chal_cv  = race_results[mt_winner]['mae_cv']

        # Addestra il miglior Challenger sul set completo
        if mt_winner == 'stack':
            chal_c_final = build_ensemble(best_params, stat).fit(X, yc)
            chal_o_final = build_ensemble(best_params, stat).fit(X, yo)
        else:
            chal_c_final = build_model(mt_winner, params_winner).fit(X, yc)
            chal_o_final = build_model(mt_winner, params_winner).fit(X, yo)

        stack_str = f" | STACK:{race_results['stack']['mae_cv']:.3f}" if can_stack else ""
        n_models = len(algo_list)
        print(f"  Sfida a {n_models} (CV MAE): RF:{race_results['rf']['mae_cv']:.3f} | XGB:{race_results['xgb']['mae_cv']:.3f} | HGB:{race_results['hgb']['mae_cv']:.3f}{stack_str}")
        print(f"  >> Challenger scelto: {mt_winner.upper()} (Global CV MAE: {m_chal_cv:.4f})")

        # Champion vs Challenger
        # IMPORTANTE: se il numero di feature è cambiato, il vecchio modello è incompatibile.
        # In questo caso forziamo il challenger a vincere per aggiornare il file sul disco.
        current_n_features = len(fcols)
        champ_n_features   = metrics.get(stat, {}).get('n_features', 0)
        feature_set_changed = (champ_n_features != 0 and champ_n_features != current_n_features)

        print(f"  Confronto con Champion attuale (Global CV MAE):")
        challenger_wins, m_champ_cv = champion_vs_challenger(stat, m_chal_cv, metrics)

        # Override: se il feature set è cambiato, il challenger vince sempre (evita mismatch)
        if feature_set_changed:
            challenger_wins = True
            print(f"  [!!] Feature set cambiato ({champ_n_features} -> {current_n_features}): Challenger forzato a vincere")

        if challenger_wins:
            icon = "[OK]" if m_champ_cv > 0 else "[NEW]"
            print(f"  {icon} CV MAE: Champ {m_champ_cv:.4f} vs Chal {m_chal_cv:.4f} >> CHALLENGER VINCE")
            
            joblib.dump(chal_c_final, os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib'))
            joblib.dump(chal_o_final, os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib'))

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
            # NON ricarichiamo il vecchio champion dal disco: potrebbe avere un feature set diverso.
            # Il challenger è già trainato sulle feature correnti: usiamo lui per il Variance Predictor.

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
        pred_c = chal_c_final.predict(X)
        pred_o = chal_o_final.predict(X)
        var_yc = (yc - pred_c) ** 2
        var_yo = (yo - pred_o) ** 2

        var_params = {'n_estimators': 100, 'max_depth': 4, 'learning_rate': 0.05, 'random_state': 42}
        v_chal_c = xgb.XGBRegressor(**var_params).fit(X, var_yc)
        v_chal_o = xgb.XGBRegressor(**var_params).fit(X, var_yo)

        # Variance Champion vs Challenger
        v_wins, v_champ_glob, v_chal_glob = champion_vs_challenger_variance(ml_df, (v_chal_c, v_chal_o), var_yc, var_yo, stat)
        
        if v_wins:
            v_icon = "[OK]" if v_champ_glob > 0 else "[NEW]"
            print(f"  {v_icon} Var Global MAE: Champ {v_champ_glob:.4f} vs Chal {v_chal_glob:.4f} >> AGGIORNATO")
            joblib.dump(v_chal_c, os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_casa.joblib'))
            joblib.dump(v_chal_o, os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_ospite.joblib'))
            
            metrics[stat]['variance_mae'] = round(v_chal_glob, 4)
            metrics[stat]['variance_updated'] = True
        else:
            print(f"  [--] Var Global MAE: Champ {v_champ_glob:.4f} vs Chal {v_chal_glob:.4f} >> INVARIATO")
            metrics[stat]['variance_updated'] = False
            metrics[stat]['variance_mae'] = round(v_champ_glob, 4)

        metrics[stat]['variance_model_type'] = 'xgb'
        metrics[stat]['variance_trained_at'] = datetime.now().isoformat()

    # Salva metrics
    with open(METRICS_PATH, 'w') as f:
        json.dump(metrics, f, indent=2)

    # Save variance metrics separately
    variance_metrics = {}
    for stat in STATS:
        if stat in metrics and 'variance_mae' in metrics[stat]:
            variance_metrics[stat] = {
                'variance_model_type': metrics[stat]['variance_model_type'],
                'variance_mae': metrics[stat]['variance_mae'],
                'variance_trained_at': metrics[stat]['variance_trained_at']
            }

    with open(VARIANCE_METRICS_PATH, 'w') as f:
        json.dump(variance_metrics, f, indent=2)

    print(f"\n{'='*80}")
    print(f" {'STATISTICA':12s} | {'MOD':3s} | {'MAE GLOBALE (CV)':16s} | {'VAR MAE':7s} | {'STATUS'}")
    print(f"{'='*80}")
    for s, m in metrics.items():
        m_upd = "MOD" if m['champion_updated'] else ""
        v_upd = "VAR" if m.get('variance_updated', False) else ""
        status = f"{m_upd} {v_upd}".strip() or "[--]"
        
        mae_glob = f"{m['mae']:.3f}"
        var_mae  = f"{m.get('variance_mae', 0):.3f}"
        print(f"  {s.upper():12s} | {m['model_type'].upper():3s} | {mae_glob:16s} | {var_mae:7s} | {status}")
    print(f"\n[OK] Completato. Metriche -> {METRICS_PATH}")
    print(f"[OK] Variance Metriche -> {VARIANCE_METRICS_PATH}")

# ?????????????????????????????????????????????????????????????
# ENTRY POINT
# ?????????????????????????????????????????????????????????????
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='ML Training Pipeline')
    parser.add_argument('--tune', action='store_true',
                        help='Forza Optuna hyperparameter tuning (lento, ~5-10 min)')
    parser.add_argument('--db', default='resoconto.db',
                        help='Path al database SQLite')
    args = parser.parse_args()
    train_and_save_models(db_path=args.db, force_tune=args.tune)
