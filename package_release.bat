@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================================
echo   TIẾN HÀNH ĐÓNG GÓI BẢN PHÁT HÀNH TÌM BUS PROMAX
echo ==========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package_release.ps1"
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [THÀNH CÔNG] Bản cập nhật đã sẵn sàng trong thư mục release_dist!
) else (
    echo.
    echo [LỖI] Đóng gói thất bại. Vui lòng kiểm tra lại.
)
pause
