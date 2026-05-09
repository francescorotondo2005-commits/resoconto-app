@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo        CALCOLATORE ELITE COMBINATIONS (STEP 1%%)
echo ========================================================
echo.
echo Imposta i parametri per il filtro (premi INVIO per usare i valori di default):
echo.

set WINRATE=0.80
set /p input_winrate="Win Rate Minimo [0.80 = 80%%]: "
if not "!input_winrate!"=="" set WINRATE=!input_winrate!

set BETS=14
set /p input_bets="Scommesse Minime [14]: "
if not "!input_bets!"=="" set BETS=!input_bets!

set QUOTA=1.60
set /p input_quota="Quota Minima [1.60]: "
if not "!input_quota!"=="" set QUOTA=!input_quota!

set TOPK=5000
set /p input_topk="Max Combinazioni da Salvare [5000]: "
if not "!input_topk!"=="" set TOPK=!input_topk!

echo.
echo ========================================================
echo Parametri impostati: WinRate=%WINRATE%, Bets=%BETS%, Quota=%QUOTA%, Top=%TOPK%
echo Questo processo testera' oltre 500 Milioni di combinazioni.
echo Il tempo stimato e' di circa 10-12 minuti. Non chiudere la finestra!
echo ========================================================
echo.
echo Inizio calcolo: %time%
echo.

node grid_search_relaxed.js --minWinRate %WINRATE% --minBets %BETS% --minQuota %QUOTA% --topK %TOPK%

echo.
echo ========================================================
echo [Fase 2] Generazione del file finale e formattazione in corso...
node generate_md_1000.js
echo.

echo ========================================================
echo Sincronizzazione con il cloud (Vercel) in corso...
git add grid_search_results_relaxed.json topCombinations.md public/topCombinations.json
git commit -m "update: nuove combinazioni elite calcolate in locale con parametri personalizzati"
git push

echo ========================================================
echo FATTO! Puoi chiudere questa finestra e ricaricare la pagina web tra 1 minuto.
pause
