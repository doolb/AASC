@echo off
setlocal
cd /d "%~dp0"
call npm start -- %*
set "AASC_START_EXIT_CODE=%ERRORLEVEL%"
if not "%AASC_START_EXIT_CODE%"=="0" pause
exit /b %AASC_START_EXIT_CODE%
