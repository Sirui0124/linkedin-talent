#!/bin/bash
#
# opencli 更新检查脚本
# 用法: ./check-update.sh [--auto-update]
#

set -e

AUTO_UPDATE=false
if [ "$1" = "--auto-update" ]; then
    AUTO_UPDATE=true
fi

# 获取当前版本
CURRENT_VERSION=$(opencli --version 2>/dev/null || echo "0.0.0")

# 获取最新版本
LATEST_VERSION=$(npm view @jackwener/opencli version 2>/dev/null || echo "0.0.0")

# 比较版本
compare_versions() {
    if [ "$1" = "$2" ]; then
        echo "equal"
    elif [ "$1" = "$(printf '%s\n%s' "$1" "$2" | sort -V | head -n1)" ]; then
        echo "older"
    else
        echo "newer"
    fi
}

RESULT=$(compare_versions "$CURRENT_VERSION" "$LATEST_VERSION")

if [ "$RESULT" = "older" ]; then
    echo "⚠ opencli 有新版本可用: $LATEST_VERSION (当前: $CURRENT_VERSION)"

    if [ "$AUTO_UPDATE" = true ]; then
        echo "正在更新..."
        npm install -g @jackwener/opencli
        echo "✓ 已更新到 $LATEST_VERSION"
    else
        echo "运行以下命令更新:"
        echo "  npm install -g @jackwener/opencli"
    fi
else
    echo "✓ opencli 已是最新版本: $CURRENT_VERSION"
fi
