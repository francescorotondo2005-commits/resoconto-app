import os
os.environ["PYTHONWARNINGS"] = "ignore"
import json
import numpy as np
from sklearn.model_selection import KFold
from sklearn.metrics import mean_absolute_error
import warnings
warnings.filterwarnings('ignore')

from ml_train_all import (load_data, feature_engineering,
                           get_feature_cols, build_model, build_ensemble,
                           STATS, METRICS_PATH, BEST_PARAMS_PATH)

def evaluate_models():
    print("=" * 65)
    print("  BENCHMARK ML — K-FOLD 5 + STATO CHAMPION")
    print("=" * 65)

    df    = load_data('resoconto.db')
    ml_df = feature_engineering(df)
    print(f"\n  Dataset: {len(ml_df)} partite valide\n")

    # Carica metriche champion salvate
    champion_metrics = {}
    if os.path.exists(METRICS_PATH):
        with open(METRICS_PATH) as f:
            champion_metrics = json.load(f)

    # Carica best params Optuna (se presenti)
    best_params = {}
    if os.path.exists(BEST_PARAMS_PATH):
        with open(BEST_PARAMS_PATH) as f:
            best_params = json.load(f)

    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    rows = []

    for stat in STATS:
        fcols = get_feature_cols(stat)
        X  = ml_df[fcols]
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        results = {}
        for mt in ('rf', 'xgb', 'hgb'):
            maes = []
            for tr, te in kf.split(X):
                mc = build_model(mt).fit(X.iloc[tr], yc.iloc[tr])
                mo = build_model(mt).fit(X.iloc[tr], yo.iloc[tr])
                maes.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                              mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
            results[mt] = round(float(np.mean(maes)), 3)

        # Benchmark VotingEnsemble (solo se i parametri Optuna sono disponibili)
        can_stack = (best_params and stat in best_params and
                     all(m in best_params[stat] for m in ['rf', 'xgb', 'hgb']))
        if can_stack:
            maes = []
            for tr, te in kf.split(X):
                mc = build_ensemble(best_params, stat).fit(X.iloc[tr], yc.iloc[tr])
                mo = build_ensemble(best_params, stat).fit(X.iloc[tr], yo.iloc[tr])
                maes.append((mean_absolute_error(yc.iloc[te], mc.predict(X.iloc[te])) +
                              mean_absolute_error(yo.iloc[te], mo.predict(X.iloc[te]))) / 2)
            results['stack'] = round(float(np.mean(maes)), 3)
        else:
            results['stack'] = None

        winner = min((k for k in results if results[k] is not None), key=results.get)

        # Champion attuale
        cm = champion_metrics.get(stat, {})
        champ_mae  = cm.get('mae', '—')
        champ_type = cm.get('model_type', '—').upper() if cm else '—'
        champ_date = cm.get('trained_at', '—')[:10] if cm else '—'

        # Optuna best
        opt = best_params.get(stat, {})
        opt_mae  = opt.get('mae', '—')
        opt_type = opt.get('model_type', '—').upper() if opt else '—'

        rows.append({
            'Stat': stat.upper(),
            'RF':    results['rf'],
            'XGB':   results['xgb'],
            'HGB':   results['hgb'],
            'STACK': results['stack'] if results['stack'] is not None else '—',
            'Vincitore': winner.upper(),
            'Champion (DB)': f"{champ_type} {champ_mae}",
            'Optuna best':   f"{opt_type} {opt_mae}" if opt else '—',
            'Aggiornato il': champ_date,
        })

    # Stampa tabella
    header = f"{'Stat':12s} {'RF':>6s} {'XGB':>6s} {'HGB':>6s} {'STACK':>7s} {'Vincit.':>7s}  {'Champion':>14s}  {'Optuna':>14s}  {'Aggiornato':>12s}"
    print(header)
    print("-" * len(header))
    for r in rows:
        stack_val = f"{r['STACK']:>7.3f}" if isinstance(r['STACK'], float) else f"{'—':>7s}"
        print(f"{r['Stat']:12s} {r['RF']:>6.3f} {r['XGB']:>6.3f} {r['HGB']:>6.3f} {stack_val} "
              f"{r['Vincitore']:>7s}  {r['Champion (DB)']:>14s}  {r['Optuna best']:>14s}  {r['Aggiornato il']:>12s}")

    print("\n" + "=" * 65)
    print("  Legenda: MAE = Errore Medio Assoluto (più basso = meglio)")
    print("  Champion = modello attualmente in produzione (salvato su disco)")
    print("  Optuna   = miglior config trovata dall'ottimizzazione Bayesiana")
    print("=" * 65)


if __name__ == '__main__':
    evaluate_models()
