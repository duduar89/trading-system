@echo off
rem Demo: precios inventados y reloj a x600 (un día pasa en unos 2,4 minutos).
rem Usa su propia carpeta de datos, así no se mezcla con la mesa de verdad.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instálalo desde https://nodejs.org ^(versión 22 LTS^) y vuelve a abrir este fichero. & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install || (echo Falló npm install. & pause & exit /b 1)
)
start "" http://localhost:8766
node src/index.js --modo=sintetico --velocidad=600 --puerto=8766 --datos=data-demo
pause
