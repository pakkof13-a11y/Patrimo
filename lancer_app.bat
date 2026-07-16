@echo off
:: Se déplace dans le dossier du script
cd /d "%~dp0"

:: Lance le script PowerShell de surveillance de manière totalement invisible
powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launch_and_clean.ps1"

:: Quitte instantanément la console noire
exit