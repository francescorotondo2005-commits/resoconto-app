# 🧠 SHAP Feature Importance Report

Questo report svela il "cervello" del Machine Learning, mostrando esattamente quanto ogni singola feature pesa sulla decisione finale per ogni statistica.
Le percentuali indicano l'impatto medio assoluto (Mean Absolute SHAP Value) sul risultato atteso.

## Statistica: GOL
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_gol_h_for_hr1` | **8.4%** | Media FATTI in casa (ultime _hr1) |
| `f_gol_h_for10` | **5.2%** | Media FATTI in casa (ultime 10) |
| `f_gol_h_for5` | **4.2%** | Media FATTI in casa (ultime 5) |
| `f_gol_h_ag_hr2` | **4.0%** | Media SUBITI in casa (ultime _hr2) |
| `f_gol_a_ag_hr3` | **3.4%** | Media SUBITI ospite (ultime _hr3) |
| `f_gol_h_hag` | **3.3%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_gol_h_for_hr3` | **3.2%** | Media FATTI in casa (ultime _hr3) |
| `f_gol_a_spec_ag_hr3` | **3.1%** | f_gol_a_spec_ag_hr3 |
| `f_gol_a_spec_ag_hr1` | **3.0%** | f_gol_a_spec_ag_hr1 |
| `f_gol_a_ag10` | **2.8%** | Media SUBITI ospite (ultime 10) |

## Statistica: TIRI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tiri_h_for10` | **14.8%** | Media FATTI in casa (ultime 10) |
| `f_tiri_a_ag10` | **9.0%** | Media SUBITI ospite (ultime 10) |
| `f_tiri_h_spec_for_hr3` | **4.5%** | f_tiri_h_spec_for_hr3 |
| `f_tiri_h_spec_for_hr1` | **4.2%** | f_tiri_h_spec_for_hr1 |
| `f_tiri_h_ag_std` | **4.0%** | Media SUBITI in casa (ultime _std) |
| `f_tiri_a_spec_for_hr3` | **2.9%** | f_tiri_a_spec_for_hr3 |
| `f_tiri_a_ag_std` | **2.9%** | Media SUBITI ospite (ultime _std) |
| `f_tiri_h_for5` | **2.8%** | Media FATTI in casa (ultime 5) |
| `f_tiri_h_for3` | **2.7%** | Media FATTI in casa (ultime 3) |
| `f_tiri_h_spec_for_hr2` | **2.6%** | f_tiri_h_spec_for_hr2 |

## Statistica: TIP
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tip_h_for10` | **6.7%** | Media FATTI in casa (ultime 10) |
| `f_tip_h_spec_for_hr2` | **4.8%** | f_tip_h_spec_for_hr2 |
| `f_tip_a_spec_ag_hr1` | **4.5%** | f_tip_a_spec_ag_hr1 |
| `f_tip_a_ag10` | **3.7%** | Media SUBITI ospite (ultime 10) |
| `f_tip_h_ag_hr2` | **3.5%** | Media SUBITI in casa (ultime _hr2) |
| `f_tip_h_ag_std` | **3.3%** | Media SUBITI in casa (ultime _std) |
| `f_tip_a_spec_ag_hr3` | **3.3%** | f_tip_a_spec_ag_hr3 |
| `f_tip_a_for_std` | **3.3%** | Media FATTI ospite (ultime _std) |
| `f_tip_a_aag` | **3.2%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_tip_h_for_hr1` | **3.1%** | Media FATTI in casa (ultime _hr1) |

## Statistica: FALLI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_falli_h_for10` | **17.1%** | Media FATTI in casa (ultime 10) |
| `f_falli_a_ag10` | **16.0%** | Media SUBITI ospite (ultime 10) |
| `f_falli_h_hfor` | **3.6%** | Media FATTI in casa (SOLO partite in casa) |
| `f_falli_h_spec_for_hr2` | **3.0%** | f_falli_h_spec_for_hr2 |
| `f_falli_h_ag5` | **2.9%** | Media SUBITI in casa (ultime 5) |
| `f_falli_h_hag` | **2.8%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_falli_h_ag_std` | **2.3%** | Media SUBITI in casa (ultime _std) |
| `f_falli_str_a` | **2.3%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_falli_h_spec_ag_hr3` | **2.3%** | f_falli_h_spec_ag_hr3 |
| `f_falli_a_for10` | **2.2%** | Media FATTI ospite (ultime 10) |

## Statistica: CORNER
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_corner_h_for10` | **8.6%** | Media FATTI in casa (ultime 10) |
| `f_corner_h_ag_hr3` | **5.1%** | Media SUBITI in casa (ultime _hr3) |
| `f_corner_a_ag10` | **4.4%** | Media SUBITI ospite (ultime 10) |
| `f_corner_h_ag_std` | **4.0%** | Media SUBITI in casa (ultime _std) |
| `f_corner_a_for10` | **3.7%** | Media FATTI ospite (ultime 10) |
| `f_corner_a_ag_std` | **3.6%** | Media SUBITI ospite (ultime _std) |
| `f_corner_h_ag5` | **3.2%** | Media SUBITI in casa (ultime 5) |
| `f_corner_h_spec_for_hr2` | **3.0%** | f_corner_h_spec_for_hr2 |
| `f_corner_a_spec_for_hr3` | **2.8%** | f_corner_a_spec_for_hr3 |
| `f_corner_a_for_hr2` | **2.7%** | Media FATTI ospite (ultime _hr2) |

## Statistica: CARTELLINI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_cartellini_ref` | **6.3%** | Media Arbitro (storico totale) |
| `f_cartellini_h_for_hr1` | **5.8%** | Media FATTI in casa (ultime _hr1) |
| `f_cartellini_h_hag` | **5.1%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_cartellini_a_ag_std` | **4.2%** | Media SUBITI ospite (ultime _std) |
| `f_cartellini_h_spec_for_hr3` | **3.6%** | f_cartellini_h_spec_for_hr3 |
| `f_cartellini_h_spec_for_hr2` | **3.6%** | f_cartellini_h_spec_for_hr2 |
| `f_cartellini_a_ag3` | **3.1%** | Media SUBITI ospite (ultime 3) |
| `f_cartellini_h_ag5` | **3.0%** | Media SUBITI in casa (ultime 5) |
| `f_cartellini_a_for_hr1` | **2.9%** | Media FATTI ospite (ultime _hr1) |
| `f_cartellini_a_afor` | **2.9%** | Media FATTI ospite (SOLO partite in trasferta) |

## Statistica: PARATE
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_parate_h_for5` | **7.2%** | Media FATTI in casa (ultime 5) |
| `f_parate_a_ag10` | **5.3%** | Media SUBITI ospite (ultime 10) |
| `f_parate_a_spec_for_hr3` | **4.3%** | f_parate_a_spec_for_hr3 |
| `f_parate_a_ag5` | **4.0%** | Media SUBITI ospite (ultime 5) |
| `f_parate_a_spec_ag_hr1` | **3.9%** | f_parate_a_spec_ag_hr1 |
| `f_parate_h_for_hr2` | **3.4%** | Media FATTI in casa (ultime _hr2) |
| `f_parate_h_for_std` | **3.2%** | Media FATTI in casa (ultime _std) |
| `f_parate_h_ag_hr2` | **3.1%** | Media SUBITI in casa (ultime _hr2) |
| `f_parate_h_for10` | **3.0%** | Media FATTI in casa (ultime 10) |
| `f_parate_h_spec_ag_hr1` | **2.9%** | f_parate_h_spec_ag_hr1 |
