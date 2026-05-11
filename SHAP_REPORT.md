# 🧠 SHAP Feature Importance Report

Questo report svela il "cervello" del Machine Learning, mostrando esattamente quanto ogni singola feature pesa sulla decisione finale per ogni statistica.
Le percentuali indicano l'impatto medio assoluto (Mean Absolute SHAP Value) sul risultato atteso.

## Statistica: GOL
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_gol_h_for10` | **13.7%** | Media FATTI in casa (ultime 10) |
| `f_gol_a_ag10` | **10.1%** | Media SUBITI ospite (ultime 10) |
| `f_gol_h_ag10` | **9.4%** | Media SUBITI in casa (ultime 10) |
| `f_gol_h_for5` | **9.1%** | Media FATTI in casa (ultime 5) |
| `f_gol_str_h` | **6.2%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_gol_h_for3` | **5.8%** | Media FATTI in casa (ultime 3) |
| `f_gol_a_for10` | **5.7%** | Media FATTI ospite (ultime 10) |
| `f_gol_a_aag` | **4.9%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_gol_str_a` | **4.7%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_gol_a_for5` | **4.5%** | Media FATTI ospite (ultime 5) |

## Statistica: TIRI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tiri_h_for10` | **16.5%** | Media FATTI in casa (ultime 10) |
| `f_tiri_a_ag10` | **13.5%** | Media SUBITI ospite (ultime 10) |
| `f_tiri_a_for10` | **10.0%** | Media FATTI ospite (ultime 10) |
| `f_tiri_h_hfor` | **8.6%** | Media FATTI in casa (SOLO partite in casa) |
| `f_tiri_h_ag10` | **8.6%** | Media SUBITI in casa (ultime 10) |
| `f_tiri_h_for3` | **4.9%** | Media FATTI in casa (ultime 3) |
| `f_tiri_str_h` | **4.5%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_tiri_a_afor` | **4.3%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_tiri_h_hag` | **3.8%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_tiri_a_for5` | **3.4%** | Media FATTI ospite (ultime 5) |

## Statistica: TIP
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_tip_h_ag10` | **13.7%** | Media SUBITI in casa (ultime 10) |
| `f_tip_h_for10` | **13.4%** | Media FATTI in casa (ultime 10) |
| `f_tip_a_aag` | **8.9%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_tip_a_for10` | **8.2%** | Media FATTI ospite (ultime 10) |
| `f_tip_h_hfor` | **6.4%** | Media FATTI in casa (SOLO partite in casa) |
| `f_tip_a_ag10` | **6.1%** | Media SUBITI ospite (ultime 10) |
| `f_tip_a_ag3` | **5.7%** | Media SUBITI ospite (ultime 3) |
| `f_tip_a_for3` | **5.3%** | Media FATTI ospite (ultime 3) |
| `f_tip_h_for3` | **5.0%** | Media FATTI in casa (ultime 3) |
| `f_tip_h_ag3` | **4.6%** | Media SUBITI in casa (ultime 3) |

## Statistica: FALLI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_falli_h_for10` | **24.5%** | Media FATTI in casa (ultime 10) |
| `f_falli_a_ag10` | **18.2%** | Media SUBITI ospite (ultime 10) |
| `f_falli_h_hag` | **6.7%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_falli_h_ag10` | **5.1%** | Media SUBITI in casa (ultime 10) |
| `f_falli_a_aag` | **4.1%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_falli_a_for10` | **4.1%** | Media FATTI ospite (ultime 10) |
| `f_falli_h_for3` | **4.1%** | Media FATTI in casa (ultime 3) |
| `f_falli_h_hfor` | **3.8%** | Media FATTI in casa (SOLO partite in casa) |
| `f_falli_ref` | **3.8%** | Media Arbitro (storico totale) |
| `f_falli_str_a` | **3.6%** | Diff. Forza: Attacco Ospite vs Difesa Casa |

## Statistica: CORNER
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_corner_h_for10` | **17.8%** | Media FATTI in casa (ultime 10) |
| `f_corner_a_ag10` | **10.7%** | Media SUBITI ospite (ultime 10) |
| `f_corner_a_for10` | **7.0%** | Media FATTI ospite (ultime 10) |
| `f_corner_h_hfor` | **5.7%** | Media FATTI in casa (SOLO partite in casa) |
| `f_corner_a_ag3` | **5.5%** | Media SUBITI ospite (ultime 3) |
| `f_corner_a_aag` | **5.2%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_corner_h_ag10` | **5.1%** | Media SUBITI in casa (ultime 10) |
| `f_corner_h_for5` | **4.7%** | Media FATTI in casa (ultime 5) |
| `f_corner_str_h` | **4.5%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_corner_a_ag5` | **4.4%** | Media SUBITI ospite (ultime 5) |

## Statistica: CARTELLINI
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_cartellini_ref` | **12.0%** | Media Arbitro (storico totale) |
| `f_cartellini_h_for10` | **11.6%** | Media FATTI in casa (ultime 10) |
| `f_cartellini_h_hag` | **10.9%** | Media SUBITI in casa (SOLO partite in casa) |
| `f_cartellini_a_ag5` | **6.4%** | Media SUBITI ospite (ultime 5) |
| `f_cartellini_a_ag10` | **6.3%** | Media SUBITI ospite (ultime 10) |
| `f_cartellini_h_ag10` | **6.0%** | Media SUBITI in casa (ultime 10) |
| `f_cartellini_a_aag` | **5.6%** | Media SUBITI ospite (SOLO partite in trasferta) |
| `f_cartellini_a_for10` | **5.0%** | Media FATTI ospite (ultime 10) |
| `f_cartellini_h_ag5` | **4.3%** | Media SUBITI in casa (ultime 5) |
| `f_cartellini_a_afor` | **4.1%** | Media FATTI ospite (SOLO partite in trasferta) |

## Statistica: PARATE
| Feature | Peso (%) | Descrizione |
|---|---|---|
| `f_parate_a_ag10` | **14.7%** | Media SUBITI ospite (ultime 10) |
| `f_parate_h_for5` | **11.1%** | Media FATTI in casa (ultime 5) |
| `f_parate_a_ag5` | **10.0%** | Media SUBITI ospite (ultime 5) |
| `f_parate_str_h` | **8.4%** | Diff. Forza: Attacco Casa vs Difesa Ospite |
| `f_parate_a_afor` | **6.5%** | Media FATTI ospite (SOLO partite in trasferta) |
| `f_parate_str_a` | **6.1%** | Diff. Forza: Attacco Ospite vs Difesa Casa |
| `f_parate_h_for10` | **5.8%** | Media FATTI in casa (ultime 10) |
| `f_parate_h_ag10` | **5.7%** | Media SUBITI in casa (ultime 10) |
| `f_parate_a_for10` | **5.3%** | Media FATTI ospite (ultime 10) |
| `f_parate_a_aag` | **3.8%** | Media SUBITI ospite (SOLO partite in trasferta) |
