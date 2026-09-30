@echo off
rem Trae la última versión de GitHub (la mesa tiene que estar parada).
chcp 65001 >nul
cd /d "%~dp0"
git pull || (echo No se pudo actualizar: ¿está esta carpeta clonada con git? & pause & exit /b 1)
call npm install
echo Actualizado. Ya puedes abrir "Arrancar mesa.bat".
pause
