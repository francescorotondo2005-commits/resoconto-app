@echo off
title Scraper Service + ngrok
color 0A

echo.
echo ===============================================================
echo      AVVIO SERVIZIO SCRAPING + NGROK
echo ===============================================================
echo.
echo Questo script avvia:
echo   1. Il servizio di scraping (porta 3001)
echo   2. Il tunnel ngrok verso Vercel
echo.
echo Lascia entrambe le finestre aperte mentre usi l'app.
echo ===============================================================
echo.

:: Cartella del progetto (un livello sopra scraper-service/)
set PROJECT_DIR=%~dp0..

:: Avvia il servizio scraper in una nuova finestra
echo [1/2] Avvio Scraper Service sulla porta 3001...
start "Scraper Service (porta 3001)" cmd /k "cd /d %~dp0 && npm start"

:: Aspetta 3 secondi per dare tempo al server di avviarsi
timeout /t 3 /nobreak > nul

:: Avvia ngrok con il dominio statico
echo [2/2] Avvio ngrok tunnel...
start "ngrok Tunnel" cmd /k "cd /d %PROJECT_DIR% && ngrok.exe http 3001 --domain=radiotoxic-bobbye-sharklike.ngrok-free.dev"

echo.
echo ✅ Tutto avviato! Puoi chiudere questa finestra.
echo.
echo    Scraper Service : http://localhost:3001/health
echo    ngrok Tunnel    : https://radiotoxic-bobbye-sharklike.ngrok-free.dev/health
echo.
pause
