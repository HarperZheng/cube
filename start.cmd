@echo off
rem ============================================================
rem start.cmd -- one-click start: Cube(:4000) + chat bridge(:4100)
rem Usage: double-click or run in terminal. Idempotent: re-running
rem        never spawns a second bridge (port probe before start).
rem NOTE: keep this file 100% ASCII, comments and echo messages.
rem       Chinese in a .cmd has no safe encoding: GBK garbles in
rem       UTF-8 editors; UTF-8 + chcp hits the cmd parser offset
rem       bug (mid-line splits). Line endings must be CRLF.
rem ============================================================
cd /d %~dp0

rem ===== 0) claude CLI precheck (bridge dies on first question if missing) =====
where claude >nul 2>&1
if errorlevel 1 (
    echo [ERROR] claude CLI not found in PATH - bridge depends on host claude CLI
    pause
    exit /b 1
)

rem ===== 1) Cube semantic layer (idempotent: no-op if already up) =====
echo [1/3] Cube: docker compose up -d cube ...
docker compose up -d cube
if errorlevel 1 (
    echo [ERROR] docker compose failed - see output above
    pause
    exit /b 1
)

rem ===== 2) chat bridge (idempotent: skip if :4100 already listening) =====
curl -s -m 2 http://localhost:4100/ >nul 2>&1
if not errorlevel 1 (
    echo [2/3] bridge already running on :4100 - skip
) else (
    echo [2/3] starting bridge on :4100 ^(minimized window, Ctrl+C to stop^) ...
    start "cube-chat-bridge" /min python chat\chat_server.py
)

rem ===== 3) health checks (Cube is slow ~30-60s, cap 90s; ping not timeout: timeout refuses redirected stdin) =====
set /a tries=0
:wait_cube
curl -s -m 2 http://localhost:4000/ >nul 2>&1
if not errorlevel 1 goto cube_ok
set /a tries+=1
if %tries% geq 30 (
    echo [WARN] Cube not ready in 90s - Oracle slow or start failed, check :4000 later
    goto wait_bridge
)
ping -n 4 127.0.0.1 >nul
goto wait_cube
:cube_ok
echo [3/3] Cube :4000 ready

set /a tries=0
:wait_bridge
curl -s -m 2 http://localhost:4100/ >nul 2>&1
if not errorlevel 1 goto all_ok
set /a tries+=1
if %tries% geq 5 (
    echo [WARN] bridge :4100 not ready - see minimized window or logs\bridge-*.log
    goto done
)
ping -n 3 127.0.0.1 >nul
goto wait_bridge

:all_ok
echo Done: Cube :4000 + bridge :4100 ready - ask at panel :4000; logs: logs\bridge-*.log
:done
pause
