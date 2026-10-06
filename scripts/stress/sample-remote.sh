#!/usr/bin/env bash
# =========================================================
# 资源采样脚本 scripts/stress/sample-remote.sh
# 用途：在「被测服务所在主机」上运行，周期性采样进程与数据文件指标，
#       供压测报告中的资源曲线使用（S9 长稳重点观察缓存/RSS/WAL 增长）
# 用法：bash sample-remote.sh <持续秒数> <采样间隔秒> <数据目录> <进程匹配串>
# 输出：CSV 到 stdout，列依次为 ts,rss_kb,db_bytes,wal_bytes,load1,threads
# 说明：只读采样，不修改服务状态；不输出主机名/账号，便于直接进入报告（AC9）
# =========================================================
set -u

DURATION="${1:-60}"
INTERVAL="${2:-5}"
DATA_DIR="${3:-$HOME/aod-app/data/.stress}"
# 进程匹配串：只用于在 /proc/<pid>/cmdline 中甄别目标 node 进程
# 注意：不能用 pgrep -f 直接匹配该串——shell 包装进程的命令行同样含此串，会误命中（表现为 RSS 极小、线程数=1）
PROC_PATTERN="${4:-server/server.js}"

END=$(( $(date +%s) + DURATION ))

# 定位被测进程：仅考察可执行名恰为 node 的进程，再在其余 cmdline 中匹配目标脚本路径
find_target_pid() {
  local p
  for p in $(pgrep -x node 2>/dev/null); do
    if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "$PROC_PATTERN"; then
      echo "$p"
      return 0
    fi
  done
  echo ""
}

echo "ts,rss_kb,db_bytes,wal_bytes,load1,threads"

while [ "$(date +%s)" -lt "$END" ]; do
  TS=$(date +%s)

  # 取被测服务进程
  PID=$(find_target_pid)

  RSS=0
  THREADS=0
  if [ -n "${PID:-}" ]; then
    RSS=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ')
    THREADS=$(ls /proc/"$PID"/task 2>/dev/null | wc -l)
  fi

  # 数据库主文件与 WAL 文件大小（WAL 不断增长说明检查点跟不上）
  DB_BYTES=0
  WAL_BYTES=0
  if [ -f "$DATA_DIR/app.db" ]; then
    DB_BYTES=$(stat -c%s "$DATA_DIR/app.db" 2>/dev/null || echo 0)
  fi
  if [ -f "$DATA_DIR/app.db-wal" ]; then
    WAL_BYTES=$(stat -c%s "$DATA_DIR/app.db-wal" 2>/dev/null || echo 0)
  fi

  # 1 分钟平均负载，用于判断主机是否被压满
  LOAD1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)

  echo "$TS,${RSS:-0},${DB_BYTES:-0},${WAL_BYTES:-0},${LOAD1},${THREADS:-0}"
  sleep "$INTERVAL"
done
