#!/usr/bin/env bash
# =========================================================
# 副机（Linux）启动脚本
# AI 应用教学开放日报名系统 · 后端服务
# 用法：bash start.sh
# =========================================================
set -e

# 切到脚本所在目录下的 server/（无论从何处调用都能正确定位）
cd "$(dirname "$0")/server"

# 首次运行自动安装依赖
if [ ! -d node_modules ]; then
  echo "[1/2] 未检测到 node_modules，开始安装依赖…"
  npm install
else
  echo "[1/2] 依赖已存在，跳过安装"
fi

# 端口可通过环境变量覆盖，默认 3000
export PORT="${PORT:-3000}"

echo "[2/2] 启动服务（端口 ${PORT}）…"
exec npm start
