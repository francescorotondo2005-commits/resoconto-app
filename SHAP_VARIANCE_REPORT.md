# 🎯 SHAP Variance Feature Importance Report

Report SHAP per i **Modelli di Varianza** che determinano il CV% (Confidence).
Usare in coppia con SHAP_REPORT.md: eliminare feature con <1% peso in **entrambi** i report.

## Statistica: GOL
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_gol_a_ag_hr2` | **6.1%** | Hit Rate SUBITI Globale Ospite (soglia #2) |
| `f_gol_h_for_hr1` | **5.4%** | Hit Rate FATTI Globale Casa (soglia #1) |
| `f_gol_h_for5` | **5.0%** | Media FATTI casa (ultime 5) |
| `f_gol_a_ag5` | **4.7%** | Media SUBITI ospite (ultime 5) |
| `f_gol_h_spec_for_hr3` | **4.4%** | Hit Rate FATTI Specifico Casa (soglia #3) |
| `f_gol_a_ag_hr1` | **4.1%** | Hit Rate SUBITI Globale Ospite (soglia #1) |
| `f_gol_h_ag3` | **4.0%** | Media SUBITI casa (ultime 3) |
| `f_gol_h_ag_std` | **3.5%** | Deviazione Standard SUBITI Casa (ultime 10) |
| `f_gol_a_spec_ag_hr3` | **3.4%** | Hit Rate SUBITI Specifico Ospite (soglia #3) |
| `f_gol_h_for3` | **3.3%** | Media FATTI casa (ultime 3) |
| `f_gol_a_aag` | **3.2%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_gol_h_for_std` | **3.2%** | Deviazione Standard FATTI Casa (ultime 10) |
| `f_gol_a_for_hr3` | **3.1%** | Hit Rate FATTI Globale Ospite (soglia #3) |
| `f_gol_a_for_hr2` | **2.8%** | Hit Rate FATTI Globale Ospite (soglia #2) |
| `f_gol_a_for5` | **2.8%** | Media FATTI ospite (ultime 5) |

## Statistica: TIRI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tiri_a_for10` | **7.4%** | Media FATTI ospite (ultime 10) |
| `f_tiri_a_ag3` | **4.7%** | Media SUBITI ospite (ultime 3) |
| `f_tiri_h_hfor` | **4.6%** | Media FATTI casa (SOLO partite in casa) |
| `f_tiri_a_ag_hr2` | **4.3%** | Hit Rate SUBITI Globale Ospite (soglia #2) |
| `f_tiri_str_a` | **4.3%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_tiri_h_for_hr3` | **4.2%** | Hit Rate FATTI Globale Casa (soglia #3) |
| `f_tiri_h_ag3` | **4.1%** | Media SUBITI casa (ultime 3) |
| `f_tiri_a_ag_std` | **3.9%** | Deviazione Standard SUBITI Ospite (ultime 10) |
| `f_tiri_h_spec_ag_hr3` | **3.9%** | Hit Rate SUBITI Specifico Casa (soglia #3) |
| `f_tiri_a_for_hr2` | **3.1%** | Hit Rate FATTI Globale Ospite (soglia #2) |
| `f_tiri_a_afor` | **3.0%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_tiri_a_ag_med` | **2.9%** | Mediana SUBITI Ospite (ultime 10) |
| `f_tiri_a_for_hr3` | **2.6%** | Hit Rate FATTI Globale Ospite (soglia #3) |
| `f_tiri_h_for_hr2` | **2.5%** | Hit Rate FATTI Globale Casa (soglia #2) |
| `f_tiri_h_ag_hr3` | **2.3%** | Hit Rate SUBITI Globale Casa (soglia #3) |

## Statistica: TIP
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tip_a_ag5` | **7.2%** | Media SUBITI ospite (ultime 5) |
| `f_tip_a_aag` | **6.3%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_tip_a_for_std` | **4.7%** | Deviazione Standard FATTI Ospite (ultime 10) |
| `f_tip_a_afor` | **4.2%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_tip_h_hfor` | **4.2%** | Media FATTI casa (SOLO partite in casa) |
| `f_tip_a_for10` | **4.1%** | Media FATTI ospite (ultime 10) |
| `f_tip_a_ag_hr1` | **4.0%** | Hit Rate SUBITI Globale Ospite (soglia #1) |
| `f_tip_a_ag10` | **4.0%** | Media SUBITI ospite (ultime 10) |
| `f_tip_a_for3` | **3.9%** | Media FATTI ospite (ultime 3) |
| `f_tip_a_spec_ag_hr2` | **3.6%** | Hit Rate SUBITI Specifico Ospite (soglia #2) |
| `f_tip_a_for_hr2` | **2.8%** | Hit Rate FATTI Globale Ospite (soglia #2) |
| `f_tip_a_ag3` | **2.7%** | Media SUBITI ospite (ultime 3) |
| `f_tip_str_h` | **2.6%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_tip_h_ag_std` | **2.6%** | Deviazione Standard SUBITI Casa (ultime 10) |
| `f_tip_a_for_hr1` | **2.5%** | Hit Rate FATTI Globale Ospite (soglia #1) |

## Statistica: FALLI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_falli_h_spec_ag_hr2` | **6.5%** | Hit Rate SUBITI Specifico Casa (soglia #2) |
| `f_falli_h_hag` | **6.1%** | Media SUBITI casa (SOLO partite in casa) |
| `f_falli_a_ag_hr2` | **4.2%** | Hit Rate SUBITI Globale Ospite (soglia #2) |
| `f_falli_h_for10` | **4.1%** | Media FATTI casa (ultime 10) |
| `f_falli_str_h` | **4.0%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_falli_str_a` | **3.8%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_falli_ref` | **3.7%** | Media Arbitro (storico totale) |
| `f_falli_a_spec_for_hr3` | **3.6%** | Hit Rate FATTI Specifico Ospite (soglia #3) |
| `f_falli_h_spec_ag_hr1` | **3.1%** | Hit Rate SUBITI Specifico Casa (soglia #1) |
| `f_falli_a_for10` | **2.9%** | Media FATTI ospite (ultime 10) |
| `f_falli_a_ag5` | **2.8%** | Media SUBITI ospite (ultime 5) |
| `f_falli_h_ag_hr3` | **2.7%** | Hit Rate SUBITI Globale Casa (soglia #3) |
| `f_falli_a_spec_for_hr1` | **2.7%** | Hit Rate FATTI Specifico Ospite (soglia #1) |
| `f_falli_a_for_std` | **2.6%** | Deviazione Standard FATTI Ospite (ultime 10) |
| `f_falli_a_ag_std` | **2.3%** | Deviazione Standard SUBITI Ospite (ultime 10) |

## Statistica: CORNER
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_corner_h_hag` | **8.1%** | Media SUBITI casa (SOLO partite in casa) |
| `f_corner_h_ag5` | **6.5%** | Media SUBITI casa (ultime 5) |
| `f_corner_a_for10` | **4.0%** | Media FATTI ospite (ultime 10) |
| `f_corner_h_for10` | **3.8%** | Media FATTI casa (ultime 10) |
| `f_corner_h_for_hr2` | **3.7%** | Hit Rate FATTI Globale Casa (soglia #2) |
| `f_corner_a_ag_med` | **3.7%** | Mediana SUBITI Ospite (ultime 10) |
| `f_corner_h_hfor` | **3.7%** | Media FATTI casa (SOLO partite in casa) |
| `f_corner_str_a` | **3.5%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_corner_h_ag10` | **3.5%** | Media SUBITI casa (ultime 10) |
| `f_corner_a_for_hr2` | **3.4%** | Hit Rate FATTI Globale Ospite (soglia #2) |
| `f_corner_h_ag_std` | **3.0%** | Deviazione Standard SUBITI Casa (ultime 10) |
| `f_corner_a_spec_ag_hr2` | **2.8%** | Hit Rate SUBITI Specifico Ospite (soglia #2) |
| `f_corner_a_ag_std` | **2.4%** | Deviazione Standard SUBITI Ospite (ultime 10) |
| `f_corner_h_spec_ag_hr2` | **2.4%** | Hit Rate SUBITI Specifico Casa (soglia #2) |
| `f_corner_a_spec_ag_hr1` | **2.4%** | Hit Rate SUBITI Specifico Ospite (soglia #1) |

## Statistica: CARTELLINI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_cartellini_h_spec_for_hr3` | **9.4%** | Hit Rate FATTI Specifico Casa (soglia #3) |
| `f_cartellini_h_ag10` | **6.8%** | Media SUBITI casa (ultime 10) |
| `f_cartellini_ref` | **6.7%** | Media Arbitro (storico totale) |
| `f_cartellini_h_hag` | **6.6%** | Media SUBITI casa (SOLO partite in casa) |
| `f_cartellini_h_spec_for_hr1` | **4.8%** | Hit Rate FATTI Specifico Casa (soglia #1) |
| `f_cartellini_h_ag_hr2` | **4.4%** | Hit Rate SUBITI Globale Casa (soglia #2) |
| `f_cartellini_a_ag3` | **3.5%** | Media SUBITI ospite (ultime 3) |
| `f_cartellini_h_ag_std` | **2.9%** | Deviazione Standard SUBITI Casa (ultime 10) |
| `f_cartellini_a_spec_for_hr3` | **2.9%** | Hit Rate FATTI Specifico Ospite (soglia #3) |
| `f_cartellini_str_h` | **2.8%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_cartellini_a_for_hr2` | **2.7%** | Hit Rate FATTI Globale Ospite (soglia #2) |
| `f_cartellini_h_spec_for_hr2` | **2.6%** | Hit Rate FATTI Specifico Casa (soglia #2) |
| `f_cartellini_h_for_std` | **2.5%** | Deviazione Standard FATTI Casa (ultime 10) |
| `f_cartellini_a_for10` | **2.4%** | Media FATTI ospite (ultime 10) |
| `f_cartellini_h_hfor` | **2.3%** | Media FATTI casa (SOLO partite in casa) |

## Statistica: PARATE
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_parate_a_spec_ag_hr3` | **6.8%** | Hit Rate SUBITI Specifico Ospite (soglia #3) |
| `f_parate_h_for3` | **6.8%** | Media FATTI casa (ultime 3) |
| `f_parate_a_for_std` | **6.5%** | Deviazione Standard FATTI Ospite (ultime 10) |
| `f_parate_a_for_hr1` | **5.3%** | Hit Rate FATTI Globale Ospite (soglia #1) |
| `f_parate_a_for10` | **5.3%** | Media FATTI ospite (ultime 10) |
| `f_parate_a_spec_ag_hr1` | **4.9%** | Hit Rate SUBITI Specifico Ospite (soglia #1) |
| `f_parate_a_ag_hr1` | **4.6%** | Hit Rate SUBITI Globale Ospite (soglia #1) |
| `f_parate_str_h` | **4.2%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_parate_h_for_std` | **3.6%** | Deviazione Standard FATTI Casa (ultime 10) |
| `f_parate_h_for10` | **2.9%** | Media FATTI casa (ultime 10) |
| `f_parate_a_ag5` | **2.6%** | Media SUBITI ospite (ultime 5) |
| `f_parate_a_aag` | **2.6%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_parate_a_ag_std` | **2.5%** | Deviazione Standard SUBITI Ospite (ultime 10) |
| `f_parate_a_ag3` | **2.5%** | Media SUBITI ospite (ultime 3) |
| `f_parate_h_spec_for_hr3` | **2.5%** | Hit Rate FATTI Specifico Casa (soglia #3) |
