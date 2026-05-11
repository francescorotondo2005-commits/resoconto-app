import sqlite3
import pandas as pd
import numpy as np
import os
import json
import joblib
import argparse
import warnings
from datetime import datetime
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
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
MODELS_DIR = 'models'
METRICS_PATH    = os.path.join(MODELS_DIR, 'metrics.json')
BEST_PARAMS_PATH = os.path.join(MODELS_DIR, 'best_params.json')
COUNT_PATH      = os.path.join(MODELS_DIR, 'match_count.json')
TUNE_EVERY_N    = 50   # trigger automatico Optuna ogni N nuove partite
N_OPTUNA_TRIALS = 30   # trial per statistica
HOLDOUT_N       = 30   # ultime N partite per champion vs challenger

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
# OPTUNA TUNING
# ?????????????????????????????????????????????????????????????
def optuna_tune(ml_df, n_trials=N_OPTUNA_TRIALS):
    print(f"\n{'='*60}")
    print(f" OPTUNA TUNING ({n_trials} trial per statistica, 3 modelli in gara)")
    print(f"{'='*60}")
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    best_params = {}

    for stat in STATS:
        fcols = get_feature_cols(stat)
        X  = ml_df[fcols]
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        def objective(trial):
            mt = trial.suggest_categorical('mt', ['rf', 'xgb', 'hgb'])
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
        study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
        bt = study.best_trial
        best_params[stat] = {
            'model_type': bt.params['mt'],
            'mae': round(bt.value, 4),
            **{k: v for k, v in bt.params.items() if k != 'mt'}
        }
        print(f"[{stat.upper():12s}] Vincitore: {bt.params['mt'].upper():3s} | MAE: {bt.value:.3f}")

    os.makedirs(MODELS_DIR, exist_ok=True)
    with open(BEST_PARAMS_PATH, 'w') as f:
        json.dump(best_params, f, indent=2)
    print(f"\n[OK] Parametri salvati -> {BEST_PARAMS_PATH}")
    return best_params

# ?????????????????????????????????????????????????????????????
# CHAMPION VS CHALLENGER
# ?????????????????????????????????????????????????????????????
def champion_vs_challenger(ml_df, challenger_models, stat):
    """
    Valuta champion (modelli .joblib esistenti) vs challenger (appena addestrati)
    sulle ultime HOLDOUT_N righe di ml_df (holdout temporale).
    Ritorna True se il challenger ? migliore o non c'? champion.
    """
    champ_path_c = os.path.join(MODELS_DIR, f'rf_{stat}_casa.joblib')
    champ_path_o = os.path.join(MODELS_DIR, f'rf_{stat}_ospite.joblib')

    if not os.path.exists(champ_path_c) or not os.path.exists(champ_path_o):
        return True  # Nessun champion -> challenger vince per default

    holdout = ml_df.tail(HOLDOUT_N)
    if len(holdout) < 5:
        return True  # Troppo poche partite per valutare

    fcols = get_feature_cols(stat)
    X_h  = holdout[fcols]
    yc_h = holdout[f'target_{stat}_casa']
    yo_h = holdout[f'target_{stat}_ospite']

    # MAE champion
    try:
        champ_c = joblib.load(champ_path_c)
        champ_o = joblib.load(champ_path_o)
        
        # Check feature schema compatibility (se il vecchio modello si aspetta colonne diverse)
        if hasattr(champ_c, 'feature_names_in_'):
            if list(champ_c.feature_names_in_) != list(X_h.columns):
                print("  [!] Schema feature cambiato: vecchio Champion incompatibile. CHALLENGER prende il posto.")
                return True
                
        mae_champ = (mean_absolute_error(yc_h, champ_c.predict(X_h)) +
                     mean_absolute_error(yo_h, champ_o.predict(X_h))) / 2
    except Exception as e:
        print(f"  [!] Errore valutazione Champion ({e}). CHALLENGER prende il posto.")
        return True

    # MAE challenger
    chal_c, chal_o = challenger_models
    mae_chal = (mean_absolute_error(yc_h, chal_c.predict(X_h)) +
                mean_absolute_error(yo_h, chal_o.predict(X_h))) / 2

    better = mae_chal < mae_champ
    icon   = "[OK]" if better else "[--]"
    print(f"  {icon} Champion MAE:{mae_champ:.4f}  Challenger MAE:{mae_chal:.4f}  >> {'CHALLENGER prende il posto' if better else 'Champion rimane'}")
    return better

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

        if best_params and stat in best_params:
            p         = best_params[stat]
            mt        = p['model_type']
            params    = {k: v for k, v in p.items() if k not in ('model_type', 'mae')}
            print(f"  Modello: {mt.upper()} (params Optuna)")
        else:
            # K-Fold race tra i 3 algoritmi con params default
            results = {}
            for mt in ('rf', 'xgb', 'hgb'):
                maes = []
                for tr, te in kf.split(X):
                    mc = build_model(mt).fit(X.iloc[tr], yc.iloc[tr])
                    mo = build_model(mt).fit(X.iloc[tr], yo.iloc[tr])
                    maes.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                                 mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
                results[mt] = float(np.mean(maes))
            mt     = min(results, key=results.get)
            params = {}
            print(f"  K-Fold -> RF:{results['rf']:.3f} | XGB:{results['xgb']:.3f} | HGB:{results['hgb']:.3f} -> {mt.upper()} vince")

        # Addestra challenger su TUTTI i dati per la massima precisione
        chal_c_final = build_model(mt, params).fit(X, yc)
        chal_o_final = build_model(mt, params).fit(X, yo)

        # Champion vs Challenger
        print(f"  Champion vs Challenger (holdout ultime {HOLDOUT_N} partite):")
        challenger_wins = champion_vs_challenger(ml_df, (chal_c_final, chal_o_final), stat)

        if challenger_wins:
            joblib.dump(chal_c_final, os.path.join(MODELS_DIR, f'rf_{stat}_casa.joblib'))
            joblib.dump(chal_o_final, os.path.join(MODELS_DIR, f'rf_{stat}_ospite.joblib'))

            # Calcola MAE finale del nuovo Champion (K-Fold su tutto il dataset)
            maes_final = []
            for tr, te in kf.split(X):
                mc = build_model(mt, params).fit(X.iloc[tr], yc.iloc[tr])
                mo = build_model(mt, params).fit(X.iloc[tr], yo.iloc[tr])
                maes_final.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                                    mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
            
            mae_final = float(np.mean(maes_final))
            metrics[stat] = {
                'model_type':  mt,
                'mae':         round(mae_final, 4),
                'champion_updated': True,
                'trained_at':  datetime.now().isoformat(),
                'n_samples':   len(ml_df)
            }
        else:
            # Il Champion ha vinto, manteniamo le sue metriche ma aggiorniamo lo status
            if stat in metrics:
                metrics[stat]['champion_updated'] = False
                metrics[stat]['n_samples'] = len(ml_df)
            else:
                # Fallback di sicurezza se non c'era metrica vecchia
                metrics[stat] = {
                    'model_type': mt, 'mae': 0.0, 'champion_updated': False,
                    'trained_at': datetime.now().isoformat(), 'n_samples': len(ml_df)
                }

        # ===== MODEL B: Variance Predictor (NEW) =====
        print(f"  Training Variance Predictor for {stat}...")

        # Calculate predictions from Model A to get residuals
        pred_c = chal_c_final.predict(X)
        pred_o = chal_o_final.predict(X)

        # Calculate squared residuals (our target for variance model)
        var_yc = (yc - pred_c) ** 2  # Squared residuals for home
        var_yo = (yo - pred_o) ** 2  # Squared residuals for away

        # Use XGBoost for variance prediction as requested
        var_params = {
            'n_estimators': 100,
            'max_depth': 4,
            'learning_rate': 0.05,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'random_state': 42,
            'n_jobs': -1,
            'verbosity': 0
        }

        # Train variance models
        var_chal_c_final = xgb.XGBRegressor(**var_params).fit(X, var_yc)
        var_chal_o_final = xgb.XGBRegressor(**var_params).fit(X, var_yo)

        # Save variance models
        joblib.dump(var_chal_c_final, os.path.join(VARIANCE_MODELS_DIR, f'xgb_{stat}_casa_variance.joblib'))
        joblib.dump(var_chal_o_final, os.path.join(VARIANCE_MODELS_DIR, f'xgb_{stat}_ospite_variance.joblib'))

        # Calculate variance MAE
        var_mae_c = mean_absolute_error(var_yc, var_chal_c_final.predict(X))
        var_mae_o = mean_absolute_error(var_yo, var_chal_o_final.predict(X))
        var_mae_avg = (var_mae_c + var_mae_o) / 2

        # Update metrics to include variance information
        if stat in metrics:
            metrics[stat]['variance_model_type'] = 'xgb'
            metrics[stat]['variance_mae'] = round(var_mae_avg, 4)
            metrics[stat]['variance_trained_at'] = datetime.now().isoformat()
        else:
            metrics[stat] = {
                'model_type': mt,
                'mae': 0.0,
                'champion_updated': False,
                'trained_at': datetime.now().isoformat(),
                'n_samples': len(ml_df),
                'variance_model_type': 'xgb',
                'variance_mae': round(var_mae_avg, 4),
                'variance_trained_at': datetime.now().isoformat()
            }

        print(f"  Variance Model MAE: {var_mae_avg:.4f}")

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

    print(f"\n{'='*60}")
    print(" RIEPILOGO FINALE")
    print(f"{'='*60}")
    for s, m in metrics.items():
        upd = "[NEW] aggiornato" if m['champion_updated'] else "[--] invariato"
        var_info = f" | Var MAE: {m.get('variance_mae', 'N/A'):.3f}" if 'variance_mae' in m else ""
        print(f"  {s.upper():12s} | {m['model_type'].upper():3s} | MAE: {m['mae']:.3f}{var_info} | {upd}")
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
