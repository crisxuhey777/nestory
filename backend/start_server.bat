@echo off
setlocal
title Nestory backend
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  Nestory local backend launcher
REM  Double-click to start http://127.0.0.1:8000/api/state
REM  Change PORT below if 8000 is taken.
REM ---------------------------------------------------------------
set "HOST=127.0.0.1"
set "PORT=8000"

echo.
echo   Nestory backend
echo   ----------------
echo.

REM --- locate Python: prefer "python", fall back to the py launcher ---
set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo   [ERROR] Python was not found.
    echo.
    echo   Install Python 3.10 or newer from https://www.python.org/downloads/
    echo   and make sure "Add python.exe to PATH" is checked.
    echo.
    pause
    exit /b 1
  )
  set "PY=py -3"
)

REM --- if the port is taken, tell Nestory apart from other programs ---
netstat -ano | findstr /C:"LISTENING" | findstr /C:":%PORT% " >nul
if errorlevel 1 goto :port_free

set "KIND=down"
for /f "delims=" %%K in ('powershell -NoProfile -Command "try { $c=(Invoke-WebRequest -UseBasicParsing 'http://%HOST%:%PORT%/api/health' -TimeoutSec 2).Content; if ($c -match 'db' -or $c -match 'ai') { 'nestory' } else { 'other' } } catch { 'down' }"') do set "KIND=%%K"

if /i "%KIND%"=="nestory" (
  echo   [OK] Nestory backend is already running.
  echo.
  echo   State : http://%HOST%:%PORT%/api/state
  echo   Nothing to do - just open the web app as usual.
  echo.
  ping -n 6 127.0.0.1 >nul
  exit /b 0
)

echo   [WARN] Port %PORT% is already in use.
echo.
echo   It does not look like Nestory, or it is still starting.
echo   See which process owns it:  netstat -ano ^| findstr :%PORT%
echo   Close that process - or edit PORT in this file.
echo.
pause
exit /b 1

:port_free
echo   Database: ensuring MySQL on 127.0.0.1:3306 ...
if defined PYW (
  %PYW% "%~dp0mysql_ctl.py" ensure >nul 2>nul
) else (
  %PY% "%~dp0mysql_ctl.py" ensure
)
set "DBCODE=%ERRORLEVEL%"
title Nestory backend
if not "%DBCODE%"=="0" (
  echo.
  echo   [ERROR] MySQL did not start.
  echo   Check the log under %%LOCALAPPDATA%%\Nestory\mysql-data\mysqld.log
  echo   or run:  %PY% "%~dp0mysql_ctl.py" status
  echo.
  pause
  exit /b 1
)
echo.
echo   Python : %PY%
echo   Listen : http://%HOST%:%PORT%
echo   State  : http://%HOST%:%PORT%/api/state
echo   AI     : see the AI model lines below
echo.
echo   Keep this window open. Press Ctrl+C to stop the server.
echo.

%PY% "%~dp0server.py" --host %HOST% --port %PORT%
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo   Server exited with code %CODE%. Read the message above.
) else (
  echo   Server stopped.
)
echo.
pause
