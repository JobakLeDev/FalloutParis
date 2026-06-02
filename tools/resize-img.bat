@echo off
REM Double-clic pour redimensionner toutes les images de img\ (max 200px)
powershell -ExecutionPolicy Bypass -File "%~dp0resize-img.ps1"
echo.
pause
