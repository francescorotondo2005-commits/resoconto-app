@echo off
title Resoconto — Aggiornamento Combinazioni Elite
color 0B
cls

cd /d "C:\Users\pierr\OneDrive\Desktop\app\resoconto-app"

echo.
echo  ================================================
echo    RESOCONTO — AGGIORNAMENTO COMBINAZIONI ELITE
echo  ================================================
echo.
echo  Questo script eseguira':
echo   [1] Grid Search sul database (1-3 minuti)
echo   [2] Generazione file topCombinations
echo   [3] Push automatico su Vercel
echo.
echo  Non chiudere questa finestra!
echo.

echo  [1/3] Avvio Grid Search...
echo  ------------------------------------------------
node grid_search_relaxed.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERRORE durante il Grid Search!
    pause
    exit /b 1
)

echo.
echo  [2/3] Generazione file topCombinations...
echo  ------------------------------------------------
node generate_md_1000.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERRORE durante la generazione del file!
    pause
    exit /b 1
)

echo.
echo  [3/3] Push su Vercel (GitHub)...
echo  ------------------------------------------------
git add public/topCombinations.json topCombinations.md top_1000_combinations.md grid_search_results_relaxed.json
git commit -m "chore: Aggiornamento automatico combinazioni Elite"
git push
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERRORE durante il push su GitHub/Vercel!
    echo  Controlla la connessione e riprova.
    pause
    exit /b 1
)

echo.
echo  ================================================
echo   COMPLETATO!
echo   Le combinazioni Elite sono state aggiornate
echo   e saranno live su Vercel tra ~1 minuto.
echo  ================================================
echo.
pause
