@echo off
setlocal EnableExtensions
title CosBox Desktop Pack

rem ============================================================
rem  CosBox desktop packaging (Windows).
rem  1. Checks version consistency (see check-version.bat).
rem 2. Sets the updater signing key (TAURI_SIGNING_PRIVATE_KEY,
rem     see PACKAGING.md) and runs `npm run tauri build`.
rem  Output lands in src-tauri\target\release\bundle\ (NSIS/MSI
rem     plus the .sig update signature).
rem ============================================================

set "ROOT=%~dp0"
set "KEY=%ROOT%src-tauri\.keys\cosbox.key"

if not exist "%KEY%" (
    echo.
    echo  [!!] Signing key not found: %KEY%
    echo       Generate one first:
    echo         npm run tauri signer generate -w %KEY%
    echo       then put the printed public key into tauri.conf.json
    echo       (plugins.updater.pubkey).
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   Step 1/2: version consistency check
echo  ============================================================
call "%ROOT%check-version.bat"
if errorlevel 1 (
    echo.
    echo  [!!] Version check failed - fix versions before packaging.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   Step 2/2: npm run tauri build  (signed with %KEY%)
echo  ============================================================
rem 当前密钥是"空密码加密"的（minisign 对 -p "" 的已知行为，见 PACKAGING.md），
rem 构建时密码环境变量必须设置为空字符串（cmd 无法设置空字符串变量，用 PowerShell 包装）；
rem 若你的密钥有实际密码，把下面第二行改为实际密码。
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:TAURI_SIGNING_PRIVATE_KEY='%KEY%'; $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''; Set-Location '%ROOT%'; npm run tauri build; exit $LASTEXITCODE"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo  [OK] Build finished. Artifacts in src-tauri\target\release\bundle\
) else (
    echo  [!!] Build failed (exit code %EXITCODE%). See output above.
)
pause
exit /b %EXITCODE%
