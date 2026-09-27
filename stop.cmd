@echo off
rem ============================================================
rem stop.cmd -- one-click stop: chat bridge(:4100) + Cube(:4000)
rem Container is kept (stop, not down) - next start.cmd boots fast.
rem NOTE: keep this file 100% ASCII, comments and echo messages.
rem       Line endings must be CRLF.
rem ============================================================
cd /d %~dp0

rem ===== 1) stop bridge (kill listening PID on :4100, tree kill) =====
set found=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":4100 .*LISTENING"') do (
    set found=1
    echo [1/2] stopping bridge :4100 pid=%%p
    taskkill /PID %%p /T /F >nul 2>&1
)
if %found%==0 echo [1/2] bridge not running - skip

rem ===== 2) stop Cube =====
echo [2/2] docker compose stop cube ...
docker compose stop cube
echo Done: bridge + cube stopped (container kept, next start.cmd starts fast)
pause
