@echo off
REM ============================================================
REM Lance le bot Discord Fallout Paris (double-clic).
REM Laisse cette fenetre ouverte pendant la session.
REM ============================================================
cd /d "%~dp0"
echo Demarrage du bot Fallout Paris...
call npm start
echo.
echo Le bot s'est arrete. Appuie sur une touche pour fermer.
pause >nul
