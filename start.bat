@echo off
title 教室通知系统 - 教师端
echo.
echo ========================================
echo   教室通知系统 - 教师端
echo ========================================
echo.
echo   正在启动服务端...
echo.

start "" http://localhost:3000
node dist-server/index.js

pause
