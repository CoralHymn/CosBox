@echo off
setlocal EnableExtensions
title CosBox Version Check

rem ============================================================
rem  CosBox version consistency checker.
rem  Per PACKAGING.md ("Version & Auto Update"), the version must
rem  match in these 4 places:
rem    1. package.json                - version
rem    2. src-tauri/Cargo.toml        - [package] version
rem    3. src-tauri/tauri.conf.json   - version
rem    4. src/lib/platform/updater.ts - APP_VERSION
rem  Also shows: package-lock.json root version (reference only;
rem  npm keeps it in sync automatically) and built installer /
rem  APK artifacts (their file names embed the version).
rem ============================================================

set "ROOT=%~dp0"
set "MISMATCH=0"

echo.
echo  ============================================================
echo   CosBox version check (see PACKAGING.md)
echo  ============================================================
echo.

rem ---------- 1. package.json ----------
set "PKG_VER="
for /f "tokens=2 delims=:" %%a in ('findstr /c:"version" "%ROOT%package.json" 2^>nul') do set "PKG_VER=%%a"
set "PKG_VER=%PKG_VER:"=%"
set "PKG_VER=%PKG_VER:,=%"
set "PKG_VER=%PKG_VER: =%"

rem ---------- 2. src-tauri/Cargo.toml ----------
set "CARGO_VER="
for /f "tokens=3 delims= " %%a in ('findstr /r /b /c:"version = " "%ROOT%src-tauri\Cargo.toml" 2^>nul') do set "CARGO_VER=%%~a"

rem ---------- 3. src-tauri/tauri.conf.json ----------
set "TAURI_VER="
for /f "tokens=2 delims=:" %%a in ('findstr /c:"version" "%ROOT%src-tauri\tauri.conf.json" 2^>nul') do set "TAURI_VER=%%a"
set "TAURI_VER=%TAURI_VER:"=%"
set "TAURI_VER=%TAURI_VER:,=%"
set "TAURI_VER=%TAURI_VER: =%"

rem ---------- 4. src/lib/platform/updater.ts ----------
set "UPD_VER="
for /f "tokens=2 delims==;" %%a in ('findstr /c:"APP_VERSION" "%ROOT%src\lib\platform\updater.ts" 2^>nul') do set "UPD_VER=%%a"
set "UPD_VER=%UPD_VER: =%"
set "UPD_VER=%UPD_VER:'=%"

rem ---------- reference: package-lock.json root version (first match) ----------
set "LOCK_VER="
for /f "tokens=3 delims=:" %%a in ('findstr /n /c:"version" "%ROOT%package-lock.json" 2^>nul') do if not defined LOCK_VER set "LOCK_VER=%%a"
set "LOCK_VER=%LOCK_VER:"=%"
set "LOCK_VER=%LOCK_VER:,=%"
set "LOCK_VER=%LOCK_VER: =%"

rem ---------- reference version (first one that parsed) ----------
set "REF=%PKG_VER%"
if not defined REF set "REF=%CARGO_VER%"
if not defined REF set "REF=%TAURI_VER%"
if not defined REF set "REF=%UPD_VER%"

call :show "1. package.json"                %PKG_VER%
call :show "2. src-tauri\Cargo.toml"        %CARGO_VER%
call :show "3. src-tauri\tauri.conf.json"   %TAURI_VER%
call :show "4. src\lib\platform\updater.ts" %UPD_VER%

echo.
if not defined REF (
    color 0C
    echo  [!!] No version found in any location. Run this script from the project root!
    color 07
) else if "%MISMATCH%"=="0" (
    color 0A
    echo  [OK] All 4 locations match: %REF%
    color 07
) else (
    color 0C
    echo  [!!] Missing or mismatched versions - fix them per PACKAGING.md before packaging!
    color 07
)

echo.
echo  --- Reference info ---
if defined LOCK_VER (
    if "%LOCK_VER%"=="%REF%" (
        echo  package-lock.json root version: %LOCK_VER% - matches %REF%
    ) else (
        echo  package-lock.json root version: %LOCK_VER% - differs from %REF%; npm install will sync it
    )
) else (
    echo  package-lock.json: not found
)

echo.
echo  --- Build artifacts (shown only if built) ---
set "FOUND=0"
if exist "%ROOT%src-tauri\target\release\bundle\" (
    for /r "%ROOT%src-tauri\target\release\bundle" %%a in (*.exe *.msi *.sig) do (
        echo   %%~nxa    [%%~dpa]
        set "FOUND=1"
    )
)
if exist "%ROOT%src-tauri\gen\android\app\build\outputs\" (
    for /r "%ROOT%src-tauri\gen\android\app\build\outputs" %%a in (*.apk *.aab) do (
        echo   %%~nxa    [%%~dpa]
        set "FOUND=1"
    )
)
if "%FOUND%"=="0" echo   (no artifacts found, or not built yet)
if defined REF (
    echo.
    echo  Expected NSIS installer name: CosBox_%REF%_x64-setup.exe
)

echo.
pause
if "%MISMATCH%"=="0" (set "EXITCODE=0") else (set "EXITCODE=1")
endlocal & exit /b %EXITCODE%

:show
set "_label=%~1"
set "_val=%~2"
if not defined _val (
    echo   [MISS] %_label%  = version not found
    set "MISMATCH=1"
    exit /b
)
if "%_val%"=="%REF%" (
    echo   [OK]   %_label%  =  %_val%
) else (
    echo   [DIFF] %_label%  =  %_val%   [expected %REF%]
    set "MISMATCH=1"
)
exit /b
