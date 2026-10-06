@echo off
REM =========================================================
REM 本地（Windows）启动脚本
REM AI 应用教学开放日报名系统 · 后端服务
REM 用法：双击本文件
REM =========================================================
setlocal

REM 切到脚本所在目录下的 server\
cd /d "%~dp0server"

REM 首次运行自动安装依赖
if not exist node_modules (
  echo [1/2] 未检测到 node_modules，开始安装依赖...
  call npm install
) else (
  echo [1/2] 依赖已存在，跳过安装
)

REM 端口可通过环境变量覆盖，默认 3000
if "%PORT%"=="" set PORT=3000

echo [2/2] 启动服务（端口 %PORT%）...
echo 用户端: http://localhost:%PORT%/user.html
echo 管理端: http://localhost:%PORT%/admin.html
call npm start

endlocal
