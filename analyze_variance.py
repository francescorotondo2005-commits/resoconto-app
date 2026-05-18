import pandas as pd
import numpy as np
import shap
import xgboost as xgb
import os
os.environ["PYTHONWARNINGS"] = "ignore"
import json
from ml_train_all import load_data, feature_engineering, STATS, get_feature_cols

def format_feature_name(feat, stat):
    """Format feature names for better readability in SHAP report"""
    if "_h_for" in feat:
        num = feat.split("for")[-1]
        return f"Media FATTI in casa (ultime {num})" if num else f"Media FATTI in casa (solo casa)"
    if "_h_ag" in feat:
        num = feat.split("ag")[-1]
        return f"Media SUBITI in casa (ultime {num})" if num else f"Media SUBITI in casa (solo casa)"
    if "_h_hfor" in feat: return "Media FATTI in casa (SOLO partite in casa)"
    if "_h_hag" in feat:  return "Media SUBITI in casa (SOLO partite in casa)"
    
    if "_a_for" in feat:
        num = feat.split("for")[-1]
        return f"Media FATTI ospite (ultime {num})" if num else f"Media FATTI ospite (solo trasferta)"
    if "_a_ag" in feat:
        num = feat.split("ag")[-1]
        return f"Media SUBITI ospite (ultime {num})" if num else f"Media SUBITI ospite (solo trasferta)"
    if "_a_afor" in feat: return "Media FATTI ospite (SOLO partite in trasferta)"
    if "_a_aag" in feat:  return "Media SUBITI ospite (SOLO partite in trasferta)"
    
    if "_str_h" in feat: return "Diff. Forza: Attacco Casa vs Difesa Ospite"
    if "_str_a" in feat: return "Diff. Forza: Attacco Ospite vs Difesa Casa"
    if "_ref" in feat:   return "Media Arbitro (storico totale)"
    
    return feat

def run_variance_shap_analysis():
    """Run SHAP analysis specifically for variance models"""
    print("Avvio analisi SHAP per i modelli di VARIANZA...")
    df = load_data('resoconto.db')
    ml_df = feature_engineering(df)
    
    report_lines = [
        "# 🧠 SHAP Feature Importance Report - MODELLI DI VARIANZA",
        "",
        "Questo report mostra quali feature influenzano maggiormente la VOLATILITÀ (varianza) invece che la media.",
        "Le percentuali indicano l'impatto medio assoluto (Mean Absolute SHAP Value) sulla varianza predetta.",
        ""
    ]
    
    for stat in STATS:
        print(f"Analizzando VARIANZA per {stat.upper()}...")
        fcols = get_feature_cols(stat)
        X = ml_df[fcols]
        
        # For variance analysis, we need to calculate the squared residuals from Model A predictions
        # First, load the trained Model A (expected value) models
        import joblib
        models_dir = 'models'
        
        try:
            model_casa = joblib.load(os.path.join(models_dir, f'rf_{stat}_casa.joblib'))
            model_ospite = joblib.load(os.path.join(models_dir, f'rf_{stat}_ospite.joblib'))
        except FileNotFoundError:
            print(f"Modelli ML non trovati per {stat}, salto l'analisi...")
            continue
            
        # Get Model A predictions
        pred_casa = model_casa.predict(X)
        pred_ospite = model_ospite.predict(X)
        
        # Get actual values
        y_casa = ml_df[f'target_{stat}_casa']
        y_ospite = ml_df[f'target_{stat}_ospite']
        
        # Calculate squared residuals (our variance targets)
        var_yc = (y_casa - pred_casa) ** 2
        var_yo = (y_ospite - pred_ospite) ** 2
        
        # Combine home and away variance targets for analysis
        # We'll analyze both together since features are symmetric
        var_y_combined = np.concatenate([var_yc.values, var_yo.values])
        X_combined = pd.concat([X, X], ignore_index=True)
        
        # Train a quick XGBoost model for variance prediction to extract SHAP values
        model = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.05, random_state=42, n_jobs=-1)
        model.fit(X_combined, var_y_combined)
        
        # Calculate SHAP values
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_combined)
        
        # Mean absolute SHAP value for each feature
        vals = np.abs(shap_values).mean(0)
        feat_imp = pd.DataFrame(list(zip(X.columns, vals)), columns=['col_name', 'importanza'])
        feat_imp.sort_values(by=['importanza'], ascending=False, inplace=True)
        
        # Normalize to percentage
        total_imp = feat_imp['importanza'].sum()
        feat_imp['percentuale'] = (feat_imp['importanza'] / total_imp) * 100
        
        report_lines.append(f"## Statistica: {stat.upper()} (ANALISI VARIANZA)")
        report_lines.append("| Feature | Peso (%) | Descrizione |")
        report_lines.append("|---|---|---|")
        
        for _, row in feat_imp.head(10).iterrows():  # Show Top 10
            feat = row['col_name']
            pct = row['percentuale']
            desc = format_feature_name(feat, stat)
            report_lines.append(f"| `{feat}` | **{pct:.1f}%** | {desc} |")
        
        report_lines.append("")
        
    with open('SHAP_VARIANCE_REPORT.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_lines))
        
    print("\n[OK] Analisi SHAP della varianza completata! Leggi il file SHAP_VARIANCE_REPORT.md")

if __name__ == '__main__':
    run_variance_shap_analysis()