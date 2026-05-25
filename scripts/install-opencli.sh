#!/bin/bash
#
# opencli 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/jackwener/opencli/main/install.sh | bash
# 或者: ./install-opencli.sh
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     opencli 安装向导                        ║${NC}"
echo -e "${BLUE}║     Make any website your CLI               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# 检查 Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js 未安装${NC}"
        echo ""
        echo "请先安装 Node.js (>= 18):"
        echo "  macOS: brew install node"
        echo "  或访问: https://nodejs.org/"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${YELLOW}⚠ Node.js 版本过低 (当前: $(node -v))${NC}"
        echo "建议升级到 Node.js >= 18"
        exit 1
    fi

    echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
}

# 检查 npm
check_npm() {
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}✗ npm 未安装${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ npm $(npm -v)${NC}"
}

# 安装 opencli
install_opencli() {
    echo ""
    echo -e "${BLUE}正在安装 @jackwener/opencli...${NC}"

    if npm install -g @jackwener/opencli 2>&1; then
        echo -e "${GREEN}✓ opencli 安装成功${NC}"
    else
        echo -e "${RED}✗ 安装失败${NC}"
        exit 1
    fi
}

# 验证安装
verify_install() {
    echo ""
    echo -e "${BLUE}验证安装...${NC}"

    if command -v opencli &> /dev/null; then
        VERSION=$(opencli --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓ opencli $VERSION 已就绪${NC}"
    else
        echo -e "${RED}✗ opencli 命令不可用${NC}"
        exit 1
    fi
}

# Chrome 扩展引导
guide_chrome_extension() {
    echo ""
    echo -e "${YELLOW}══════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  下一步：安装 Chrome 扩展                    ${NC}"
    echo -e "${YELLOW}══════════════════════════════════════════════${NC}"
    echo ""
    echo "opencli 需要 Chrome 扩展才能控制浏览器。"
    echo ""
    echo -e "${BLUE}安装步骤：${NC}"
    echo "1. 打开 Chrome Web Store:"
    echo -e "   ${GREEN}https://chromewebstore.google.com/detail/opencli-browser-bridge/xxx${NC}"
    echo ""
    echo "2. 点击「添加至 Chrome」"
    echo ""
    echo "3. 安装完成后，运行以下命令验证连接:"
    echo -e "   ${GREEN}opencli doctor${NC}"
    echo ""
    echo -e "${YELLOW}提示：扩展安装后需要刷新已打开的页面${NC}"
}

# 运行 doctor
run_doctor() {
    echo ""
    echo -e "${BLUE}检查浏览器连接...${NC}"

    if opencli doctor 2>&1 | grep -q "connected\|ready"; then
        echo -e "${GREEN}✓ 浏览器扩展已连接${NC}"
    else
        echo -e "${YELLOW}⚠ 浏览器扩展未连接${NC}"
        echo "请确保："
        echo "1. Chrome 扩展已安装"
        echo "2. Chrome 浏览器正在运行"
        echo "3. 扩展已启用"
    fi
}

# 主流程
main() {
    echo -e "${BLUE}Step 1: 检查环境依赖${NC}"
    check_node
    check_npm

    # 检查是否已安装
    if command -v opencli &> /dev/null; then
        CURRENT_VERSION=$(opencli --version 2>/dev/null || echo "unknown")
        echo ""
        echo -e "${YELLOW}opencli 已安装 (版本: $CURRENT_VERSION)${NC}"
        read -p "是否更新到最新版本? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "跳过安装"
        else
            install_opencli
        fi
    else
        install_opencli
    fi

    verify_install

    # 检查 Chrome 扩展
    echo ""
    read -p "是否检查 Chrome 扩展连接? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        run_doctor
    fi

    guide_chrome_extension

    echo ""
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  安装完成！                                ${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════${NC}"
    echo ""
    echo "快速开始:"
    echo "  opencli --help          查看帮助"
    echo "  opencli list            列出可用命令"
    echo "  opencli doctor          检查浏览器连接"
    echo ""
}

main "$@"
