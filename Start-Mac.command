#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")"
wait_on_error() { echo "启动失败。请查看上方说明，然后按回车关闭。"; read -r _ || true; }
trap wait_on_error ERR
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "晨报台需要 Node.js 22 或更高版本。请从 https://nodejs.org 安装后重新打开。"
  wait_on_error
  exit 1
fi
if [ ! -f node_modules/@vladmandic/face-api/dist/face-api.esm.js ] || [ ! -d node_modules/ical.js ] || [ ! -d node_modules/fast-xml-parser ]; then npm ci --omit=dev --no-audit --no-fund; fi
base="$HOME/Library/Application Support/MorningBrief"
runtime="$base/runtime"
agents="$HOME/Library/LaunchAgents"
label="local.morningbrief.wall"
domain="gui/$(id -u)"
mkdir -p "$runtime/public" "$runtime/node_modules/@vladmandic/face-api" "$base/logs" "$agents"
cp server.mjs brief.mjs modules.mjs package.json package-lock.json starter-feeds.json "$runtime/"
cp -R public/. "$runtime/public/"
cp -R node_modules/. "$runtime/node_modules/"
plist="$agents/$label.plist"
plstage="$(mktemp -d)"
trap 'rmdir "$plstage" 2>/dev/null || true' EXIT
p="$plstage/agent.plist"
/usr/bin/plutil -create xml1 "$p"
/usr/bin/plutil -insert Label -string "$label" "$p"
/usr/bin/plutil -insert ProgramArguments -array "$p"
/usr/bin/plutil -insert ProgramArguments.0 -string "$(command -v node)" "$p"
/usr/bin/plutil -insert ProgramArguments.1 -string "$runtime/server.mjs" "$p"
/usr/bin/plutil -insert WorkingDirectory -string "$runtime" "$p"
/usr/bin/plutil -insert RunAtLoad -bool YES "$p"
/usr/bin/plutil -insert KeepAlive -bool YES "$p"
/usr/bin/plutil -insert ThrottleInterval -integer 30 "$p"
/usr/bin/plutil -insert StandardOutPath -string "$base/logs/service.log" "$p"
/usr/bin/plutil -insert StandardErrorPath -string "$base/logs/error.log" "$p"
/usr/bin/plutil -lint "$p"
mv "$p" "$plist"
if launchctl print "$domain/$label" >/dev/null 2>&1; then launchctl bootout "$domain/$label"; fi
launchctl bootstrap "$domain" "$plist"
for ((attempt=1;attempt<=20;attempt++)); do
  if /usr/bin/curl -fsS --max-time 1 http://127.0.0.1:4317/api/wall 2>/dev/null | /usr/bin/grep -q '"publicBrief"'; then
    open http://127.0.0.1:4317
    echo "晨报台已启动。关闭此窗口后仍会运行，下次登录此 Mac 时自动启动。"
    exit 0
  fi
  sleep 1
done
echo "服务未响应。日志位于 $base/logs/error.log"
wait_on_error
exit 1

