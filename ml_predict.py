import sqlite3
import pandas as pd
import numpy as np
import joblib
import argparse
import json
import warnings
import sys
import os

warnings.filterwarnings('ignore')

# Sopprimi completamente i warning su stderr per evitare crash nel buffer Node.js
sys.stderr = open(os.devnull, 'w')

# Importa le funzioni condivise da ml_train_all
from ml_train_all import STATS, get_stat, get_feature_cols, _avg, VARIANCE_MODELS_DIR

# ─────────────────────────────────────────────────────────────
# CALCOLO FEATURE PER LA PREDIZIONE
# ─────────────────────────────────────────────────────────────
def calculate_team_features(df, target_teams, target_refs):
    """
    Scorre l'intero DB e calcola le stesse feature avanzate usate in training
    per ogni squadra e arbitro coinvolti nelle partite da prevedere.
    """
    team_hist = {t: {s: {'for_all': [], 'ag_all': [],
                          'home_for': [], 'home_ag': [],
                          'away_for': [], 'away_ag': []}
                     for s in STATS}
                 for t in target_teams}
    ref_hist  = {r: {s: [] for s in STATS} for r in target_refs if r}

    for row in df.itertuples():
        h   = row.home_team
        a   = row.away_team
        ref = str(getattr(row, 'referee', '') or '')

        for s in STATS:
            row_d = row._asdict()
            hv = get_stat(row_d, s, True)
            av = get_stat(row_d, s, False)

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
            if ref in ref_hist:
                ref_hist[ref][s].append(hv + av)

    return team_hist, ref_hist


def build_features_for_match(home, away, ref, team_hist, ref_hist):
    """Costruisce il dizionario di feature per una singola partita."""
    features = {}
    ref = str(ref or '')

    for s in STATS:
        h = team_hist.get(home, {}).get(s, {'for_all': [], 'ag_all': [],
                                             'home_for': [], 'home_ag': [],
                                             'away_for': [], 'away_ag': []})
        a = team_hist.get(away, {}).get(s, {'for_all': [], 'ag_all': [],
                                             'home_for': [], 'home_ag': [],
                                             'away_for': [], 'away_ag': []})

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

    return features


# ─────────────────────────────────────────────────────────────
# PREDIZIONE BATCH
# ─────────────────────────────────────────────────────────────
def predict_batch(matches):
    try:
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resoconto.db')
        conn = sqlite3.connect(db_path, timeout=30)
        df   = pd.read_sql_query("SELECT * FROM matches ORDER BY date ASC", conn)
        conn.close()

        target_teams = set()
        target_refs  = set()
        for m in matches:
            target_teams.add(m['home'])
            target_teams.add(m['away'])
            if m.get('referee'):
                target_refs.add(str(m['referee']))

        team_hist, ref_hist = calculate_team_features(df, target_teams, target_refs)

        # Carica tutti i modelli una sola volta
        models = {}
        var_models = {}
        models_dir = 'models'
        for s in STATS:
            models[f'{s}_casa']   = joblib.load(os.path.join(models_dir, f'rf_{s}_casa.joblib'))
            models[f'{s}_ospite'] = joblib.load(os.path.join(models_dir, f'rf_{s}_ospite.joblib'))
            
            # Carica i modelli di varianza (con fallback se non sono ancora stati addestrati)
            try:
                var_models[f'{s}_casa'] = joblib.load(os.path.join(VARIANCE_MODELS_DIR, f'xgb_{s}_casa_variance.joblib'))
                var_models[f'{s}_ospite'] = joblib.load(os.path.join(VARIANCE_MODELS_DIR, f'xgb_{s}_ospite_variance.joblib'))
            except FileNotFoundError:
                var_models[f'{s}_casa'] = None
                var_models[f'{s}_ospite'] = None

        batch_results = []
        for m in matches:
            home = m['home']
            away = m['away']
            ref  = m.get('referee', '')

            feats = build_features_for_match(home, away, ref, team_hist, ref_hist)
            match_preds = {}

            for s in STATS:
                fcols = get_feature_cols(s)
                X     = pd.DataFrame([{c: feats.get(c, 0) for c in fcols}])
                
                # Previsione EV
                pred_c = float(models[f'{s}_casa'].predict(X)[0])
                pred_o = float(models[f'{s}_ospite'].predict(X)[0])
                match_preds[s] = {'casa': round(pred_c, 2), 'ospite': round(pred_o, 2)}
                
                # Previsione Varianza
                if var_models[f'{s}_casa'] is not None and var_models[f'{s}_ospite'] is not None:
                    var_c = float(var_models[f'{s}_casa'].predict(X)[0])
                    var_o = float(var_models[f'{s}_ospite'].predict(X)[0])
                    match_preds[s]['casa_var'] = round(var_c, 4)
                    match_preds[s]['ospite_var'] = round(var_o, 4)

            batch_results.append(match_preds)

        print(json.dumps(batch_results))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
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
    args = parser.parse_args()

    if args.batch_file:
        with open(args.batch_file, 'r', encoding='utf-8') as f:
            matches = json.load(f)
        predict_batch(matches)
    elif args.batch:
        predict_batch(json.loads(args.batch))
    elif args.home and args.away:
        predict_batch([{'home': args.home, 'away': args.away, 'referee': args.referee}])
    else:
        print(json.dumps({'error': 'Argomenti mancanti: usa --home/--away o --batch'}))
        sys.exit(1)