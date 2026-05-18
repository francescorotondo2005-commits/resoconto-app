"""
analyze_variance_shap.py — Report SHAP per i Modelli di Varianza (CV%)

Genera SHAP_VARIANCE_REPORT.md con l'importanza di ogni feature
per i modelli che predicono la VARIANZA (incertezza) della previsione.
Usare in coppia con analyze_features.py per il Doppio SHAP Pruning:
  - Una feature si elimina SOLO SE inutile in ENTRAMBI i report.
"""
import pandas as pd
import numpy as np
import shap
import xgboost as xgb
import joblib
import os
os.environ["PYTHONWARNINGS"] = "ignore"
import warnings
warnings.filterwarnings('ignore')

from ml_train_all import (
    load_data, feature_engineering, STATS, get_feature_cols,
    MODELS_DIR, VARIANCE_MODELS_DIR
)

def format_feature_name(feat):
    """Traduzione nome feature in descrizione leggibile."""
    # Hit Rates
    if '_hr' in feat:
        side = 'Casa' if '_h_' in feat else 'Ospite'
        n = feat.split('_hr')[-1]
        if '_spec_for_hr' in feat:
            return f"Hit Rate FATTI Specifico {side} (soglia #{n})"
        if '_spec_ag_hr' in feat:
            return f"Hit Rate SUBITI Specifico {side} (soglia #{n})"
        if '_for_hr' in feat:
            return f"Hit Rate FATTI Globale {side} (soglia #{n})"
        if '_ag_hr' in feat:
            return f"Hit Rate SUBITI Globale {side} (soglia #{n})"
    # Std Dev
    if '_for_std' in feat:
        side = 'Casa' if '_h_' in feat else 'Ospite'
        return f"Deviazione Standard FATTI {side} (ultime 10)"
    if '_ag_std' in feat:
        side = 'Casa' if '_h_' in feat else 'Ospite'
        return f"Deviazione Standard SUBITI {side} (ultime 10)"
    # Mediana
    if '_for_med' in feat:
        side = 'Casa' if '_h_' in feat else 'Ospite'
        return f"Mediana FATTI {side} (ultime 10)"
    if '_ag_med' in feat:
        side = 'Casa' if '_h_' in feat else 'Ospite'
        return f"Mediana SUBITI {side} (ultime 10)"
    # Feature classiche
    if '_h_for' in feat:
        num = feat.split('for')[-1]
        return f"Media FATTI casa (ultime {num})" if num.isdigit() else "Media FATTI casa (SOLO casa)"
    if '_h_ag' in feat:
        num = feat.split('ag')[-1]
        return f"Media SUBITI casa (ultime {num})" if num.isdigit() else "Media SUBITI casa (SOLO casa)"
    if '_h_hfor' in feat: return "Media FATTI casa (SOLO partite in casa)"
    if '_h_hag' in feat:  return "Media SUBITI casa (SOLO partite in casa)"
    if '_a_for' in feat:
        num = feat.split('for')[-1]
        return f"Media FATTI ospite (ultime {num})" if num.isdigit() else "Media FATTI ospite (SOLO trasferta)"
    if '_a_ag' in feat:
        num = feat.split('ag')[-1]
        return f"Media SUBITI ospite (ultime {num})" if num.isdigit() else "Media SUBITI ospite (SOLO trasferta)"
    if '_a_afor' in feat: return "Media FATTI ospite (SOLO partite in trasferta)"
    if '_a_aag' in feat:  return "Media SUBITI ospite (SOLO partite in trasferta)"
    if '_str_h' in feat:  return "Diff. Forza: Attacco Casa vs Difesa Ospite"
    if '_str_a' in feat:  return "Diff. Forza: Attacco Ospite vs Difesa Casa"
    if '_ref' in feat:    return "Media Arbitro (storico totale)"
    return feat


def run_variance_shap_analysis():
    print("=" * 60)
    print(" SHAP ANALYSIS — MODELLI DI VARIANZA (CV%)")
    print("=" * 60)
    print("Caricamento dati...")
    df    = load_data('resoconto.db')
    ml_df = feature_engineering(df)

    report_lines = [
        "# 🎯 SHAP Variance Feature Importance Report",
        "",
        "Report SHAP per i **Modelli di Varianza** che determinano il CV% (Confidence).",
        "Usare in coppia con SHAP_REPORT.md: eliminare feature con <1% peso in **entrambi** i report.",
        ""
    ]

    any_model_found = False

    for stat in STATS:
        print(f"\nAnalizzando varianza {stat.upper()}...")
        fcols = get_feature_cols(stat)
        X     = ml_df[fcols]

        # Carica modello principale per calcolare i residui (target della varianza)
        model_c_path = os.path.join(MODELS_DIR, f'model_{stat}_casa.joblib')
        model_o_path = os.path.join(MODELS_DIR, f'model_{stat}_ospite.joblib')
        var_c_path   = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_casa.joblib')
        var_o_path   = os.path.join(VARIANCE_MODELS_DIR, f'variance_{stat}_ospite.joblib')

        if not os.path.exists(var_c_path):
            print(f"  [SKIP] Modello varianza non trovato per {stat}")
            continue

        any_model_found = True
        yc = ml_df[f'target_{stat}_casa']
        yo = ml_df[f'target_{stat}_ospite']

        # Ricalcola il target di varianza: errore quadratico del modello principale
        main_c = joblib.load(model_c_path)
        main_o = joblib.load(model_o_path)
        var_target_c = (yc - main_c.predict(X)) ** 2
        var_target_o = (yo - main_o.predict(X)) ** 2
        var_target   = (var_target_c + var_target_o) / 2

        # Addestra un XGBoost veloce per SHAP (identico al modello di varianza reale)
        var_model = xgb.XGBRegressor(
            n_estimators=100, max_depth=4, learning_rate=0.05,
            random_state=42, n_jobs=-1, verbosity=0
        )
        var_model.fit(X, var_target)

        # SHAP
        explainer  = shap.TreeExplainer(var_model)
        shap_vals  = explainer.shap_values(X)
        vals       = np.abs(shap_vals).mean(0)
        feat_imp   = pd.DataFrame(list(zip(X.columns, vals)), columns=['col_name', 'importanza'])
        feat_imp.sort_values(by=['importanza'], ascending=False, inplace=True)
        total_imp  = feat_imp['importanza'].sum()
        feat_imp['percentuale'] = (feat_imp['importanza'] / total_imp) * 100

        report_lines.append(f"## Statistica: {stat.upper()}")
        report_lines.append("| Feature | Peso (%) | Descrizione |")
        report_lines.append("|---|---|---|")

        for _, row in feat_imp.head(15).iterrows():  # Top 15 per la varianza
            feat = row['col_name']
            pct  = row['percentuale']
            desc = format_feature_name(feat)
            report_lines.append(f"| `{feat}` | **{pct:.1f}%** | {desc} |")

        report_lines.append("")

    if not any_model_found:
        print("\n[WARN] Nessun modello di varianza trovato. Esegui prima ml_train_all.py.")
        return

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SHAP_VARIANCE_REPORT.md')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_lines))

    print(f"\n[OK] Analisi varianza completata! Report: {out_path}")
    print("     Usa questo report INSIEME a SHAP_REPORT.md per il Doppio Pruning.")


if __name__ == '__main__':
    run_variance_shap_analysis()
