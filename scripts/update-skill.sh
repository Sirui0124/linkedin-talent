#!/usr/bin/env bash
#
# Safe skill updater.
# Updates code/templates with git ff-only and never deletes or overwrites data/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SKILL_ROOT"

if ! git fetch origin main --quiet 2>/dev/null; then
  echo "⚠ GitHub 连接超时，跳过更新"
  exit 0
fi

STATUS="$(git status --short --branch)"

if printf '%s\n' "$STATUS" | grep -q 'behind'; then
  if git pull origin main --ff-only --quiet 2>/dev/null; then
    echo "↑ linkedin-talent 已更新到最新版本"
  else
    echo "⚠ 检测到远端更新，但本地有改动或无法 fast-forward；未覆盖本地文件，继续执行"
  fi
  exit 0
fi

if printf '%s\n' "$STATUS" | tail -n +2 | grep -q .; then
  echo "✓ linkedin-talent 代码版本无远端落后；检测到本地未提交改动，已保留"
else
  echo "✓ linkedin-talent 已是最新版"
fi
