@echo off
rem Arranca la mesa de trading y abre el panel en el navegador.
rem Sin claves en .env: precios reales de cripto y bróker simulado con 100.000 $.
rem Con claves de Alpaca paper en .env: opera en la cuenta demo de Alpaca.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instálalo desde https://nodejs.org ^(versión 22 LTS^) y vuelve a abrir este fichero. & pause & exit /b 1)
node -e "process.exit(+process.versions.node.split('.')[0] < 20 ? 1 : 0)" || (echo Tu Node.js es muy antiguo: hace falta la versión 20 o posterior ^(mejor la 22 LTS^). & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install || (echo Falló npm install. & pause & exit /b 1)
)
rem El panel reintenta la conexión solo: se puede abrir antes de que la mesa acabe de arrancar.
start "" http://localhost:8765
node src/index.js
echo.
echo La mesa se ha parado. Puedes cerrar esta ventana.
pause
