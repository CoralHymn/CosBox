@echo off
setlocal EnableExtensions
title CosBox Desktop Pack

rem ============================================================
rem  CosBox desktop packaging (Windows).
rem  1. Checks version consistency (see check-version.bat).
rem  2. Sets the updater signing key (TAURI_SIGNING_PRIVATE_KEY,
rem     see PACKAGING.md) and runs `npm run tauri build`.
rem  Output lands in src-tauri\target\release\bundle\ (NSIS/MSI
rem     plus the .sig update signature).
rem
rem  NOTE: keep this file ASCII-only with CRLF line endings.
rem  UTF-8 Chinese text breaks cmd.exe parsing on GBK codepages
rem  (the batch file would exit immediately / "flash close").
rem ============================================================

set "ROOT=%~dp0"
set "KEY=%ROOT%src-tauri\.keys\cosbox.key"

if not exist "%KEY%" (
    echo.
    echo  [!!] Signing key not found: %KEY%
    echo       Generate one first:
    echo         npm run tauri signer generate -w %KEY%
    echo       then paste the printed public key into the
    echo       plugins.updater.pubkey config field.
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
rem The key is encrypted with an EMPTY password (minisign 0.7.x
rem behavior for `-p ""`, see PACKAGING.md), so the password env
rem var MUST be set to an empty string. cmd.exe cannot create an
rem empty-string env var, hence the PowerShell wrapper. If your
rem key has a real password, put it in the second assignment.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:TAURI_SIGNING_PRIVATE_KEY='%KEY%'; $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''; Set-Location '%ROOT%'; npm run tauri build; exit $LASTEXITCODE"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo  [OK] Build finished. Artifacts in src-tauri\target\release\bundle\
) else (
    echo  [!!] Build failed with exit code %EXITCODE%. See output above.
)
pause
exit /b %EXITCODE%
