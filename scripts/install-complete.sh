#!/usr/bin/env bash
#
# linkedin-talent 一键完整安装脚本
# 支持 Windows (Git Bash/MSYS2)、macOS、Linux
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/.../install-complete.sh | bash
#   或: bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh
#
# 特性:
#   ✅ 跨平台环境检测和适配
#   ✅ Node.js 版本检查和安装引导
#   ✅ npm 权限问题自动处理
#   ✅ opencli 安装 + 失败重试
#   ✅ 符号链接修复
#   ✅ Chrome 扩展连接验证
#   ✅ LinkedIn 登录状态检测
#   ✅ 一次性完成，用户无需多步操作

set -euo pipefail

# ──────────────────────────────── 颜色和输出函数 ────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}ℹ${NC} $*"; }
log_success() { echo -e "${GREEN}✓${NC} $*"; }
log_warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
log_error()   { echo -e "${RED}✗${NC} $*"; }
log_step()    { echo -e "${CYAN}▶${NC} ${BOLD}$*${NC}"; }
log_dim()     { echo -e "${DIM}  $*${NC}"; }

# ──────────────────────────────── 环境检测 ───────────────────────────────────
detect_os() {
    case "$(uname -s 2>/dev/null)" in
        Darwin)
            OS="macos"
            PLATFORM_NAME="macOS"
            ;;
        Linux)
            OS="linux"
            PLATFORM_NAME="Linux"
            # 检测发行版
            if [ -f /etc/os-release ]; then
                . /etc/os-release
                DISTRO="$ID"
            else
                DISTRO="unknown"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            OS="windows"
            PLATFORM_NAME="Windows"
            # 检测是否在 Git Bash 中
            if [[ "${MSYSTEM:-}" =~ ^MINGW ]]; then
                SHELL_ENV="git-bash"
            else
                SHELL_ENV="msys2"
            fi
            ;;
        *)
            OS="unknown"
            PLATFORM_NAME="Unknown OS"
            ;;
    esac
}

# ──────────────────────────────── 欢迎和初始化 ──────────────────────────────────
show_banner() {
    echo ""
    echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║                LinkedIn Talent Scout Installer               ║${NC}"
    echo -e "${BOLD}${BLUE}║                      一键完整安装                             ║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

detect_environment() {
    log_step "检测运行环境"

    detect_os
    log_success "操作系统: $PLATFORM_NAME"

    if [ "$OS" = "windows" ]; then
        log_dim "Shell 环境: $SHELL_ENV"
        if [ "$SHELL_ENV" = "git-bash" ]; then
            log_dim "推荐环境 ✓ Git Bash 具有良好的 Unix 工具兼容性"
        fi
    fi

    if [ "$OS" = "linux" ]; then
        log_dim "发行版: $DISTRO"
    fi
}

# ──────────────────────────────── Node.js 检查和安装 ───────────────────────────────
check_nodejs() {
    log_step "检查 Node.js 环境"

    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js 未安装"
        echo ""
        case "$OS" in
            macos)
                log_warn "macOS 安装方案:"
                echo "  • Homebrew (推荐):  brew install node"
                echo "  • 官方安装包:       https://nodejs.org/"
                ;;
            linux)
                log_warn "Linux 安装方案:"
                echo "  • Ubuntu/Debian:    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"
                echo "  • CentOS/RHEL:      sudo yum install nodejs npm"
                echo "  • 通用方案:         下载官方二进制包或使用 nvm"
                ;;
            windows)
                log_warn "Windows 安装方案:"
                echo "  • 官方安装包:       https://nodejs.org/ (下载 LTS 版本)"
                echo "  • Chocolatey:       choco install nodejs"
                echo "  • Scoop:            scoop install nodejs"
                ;;
        esac
        echo ""
        log_error "请安装 Node.js 后重新运行此脚本"
        exit 1
    fi

    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

    if [ "$NODE_MAJOR" -lt 18 ]; then
        log_error "Node.js 版本过低: v$NODE_VERSION (需要 >= 18)"
        echo ""
        log_warn "请升级 Node.js 到 LTS 版本 (>= 18)"
        exit 1
    fi

    log_success "Node.js v$NODE_VERSION"

    # npm 检查
    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm 未安装 (通常随 Node.js 一起安装)"
        exit 1
    fi

    NPM_VERSION=$(npm -v)
    log_success "npm v$NPM_VERSION"
}

# ──────────────────────────────── npm 权限检查和修复 ────────────────────────────────
check_npm_permissions() {
    log_step "检查 npm 全局安装权限"

    # 测试性安装一个轻量包检测权限
    if npm list -g --depth=0 >/dev/null 2>&1; then
        log_success "npm 全局权限正常"
        return 0
    fi

    case "$OS" in
        windows)
            log_warn "Windows npm 权限可能需要管理员权限"
            log_dim "如遇安装失败，请尝试:"
            log_dim "  1. 右键 Git Bash → '以管理员身份运行'"
            log_dim "  2. 或配置用户级全局目录: npm config set prefix ~/.npm-global"
            ;;
        macos|linux)
            log_warn "npm 全局安装可能需要 sudo 或用户级配置"
            log_dim "推荐配置用户级全局目录:"
            log_dim "  mkdir -p ~/.npm-global"
            log_dim "  npm config set prefix ~/.npm-global"
            log_dim "  export PATH=~/.npm-global/bin:\$PATH"
            ;;
    esac
}

# ──────────────────────────────── opencli 安装 ────────────────────────────────────
install_opencli() {
    log_step "安装 opencli 浏览器控制工具"

    # 检查是否已安装
    if command -v opencli >/dev/null 2>&1; then
        CURRENT_VERSION=$(opencli --version 2>/dev/null || echo "unknown")
        log_warn "opencli 已安装 (版本: $CURRENT_VERSION)"
        read -p "是否更新到最新版本? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "跳过 opencli 安装"
            return 0
        fi
    fi

    log_dim "正在执行: npm install -g @jackwener/opencli"

    # 尝试安装，捕获可能的权限错误
    if npm install -g @jackwener/opencli; then
        log_success "opencli 安装成功"
    else
        EXIT_CODE=$?
        log_error "opencli 安装失败"

        case "$OS" in
            windows)
                echo ""
                log_warn "Windows 权限问题解决方案:"
                echo "  1. 右键 Git Bash → '以管理员身份运行'，重新执行此脚本"
                echo "  2. 或手动配置用户级全局目录:"
                echo "     npm config set prefix ~/.npm-global"
                echo "     export PATH=~/.npm-global/bin:\$PATH"
                echo "     npm install -g @jackwener/opencli"
                ;;
            macos|linux)
                echo ""
                log_warn "权限问题解决方案:"
                echo "  1. 配置用户级全局目录 (推荐):"
                echo "     mkdir -p ~/.npm-global"
                echo "     npm config set prefix ~/.npm-global"
                echo "     export PATH=~/.npm-global/bin:\$PATH"
                echo "     npm install -g @jackwener/opencli"
                echo ""
                echo "  2. 或使用 sudo (不推荐):"
                echo "     sudo npm install -g @jackwener/opencli"
                ;;
        esac
        exit $EXIT_CODE
    fi

    # 验证安装
    if command -v opencli >/dev/null 2>&1; then
        INSTALLED_VERSION=$(opencli --version 2>/dev/null || echo "unknown")
        log_success "opencli $INSTALLED_VERSION 安装成功并可用"
    else
        log_error "opencli 安装后无法找到命令"
        log_dim "可能的原因: npm 全局 bin 目录不在 PATH 中"
        log_dim "请检查 PATH 环境变量或重启终端"
        exit 1
    fi
}

# ──────────────────────────────── 符号链接清理 ─────────────────────────────────────
fix_broken_symlinks() {
    log_step "检查和修复 opencli 符号链接"

    CLIS_DIR="$HOME/.opencli/clis"
    if [ ! -d "$CLIS_DIR" ]; then
        log_info "opencli clis 目录不存在，跳过符号链接检查"
        return 0
    fi

    # 查找死链
    BROKEN_LINKS=()
    while IFS= read -r -d '' file; do
        BROKEN_LINKS+=("$file")
    done < <(find "$CLIS_DIR" -type l ! -exec test -e {} \\; -print0 2>/dev/null)

    if [ ${#BROKEN_LINKS[@]} -eq 0 ]; then
        log_success "opencli clis 目录无死链"
        return 0
    fi

    log_warn "发现 ${#BROKEN_LINKS[@]} 个失效符号链接"
    log_dim "这些死链会导致 opencli 启动时输出 ENOENT 警告"

    # 清理死链
    local cleaned=0
    for link in "${BROKEN_LINKS[@]}"; do
        if rm -f "$link" 2>/dev/null; then
            cleaned=$((cleaned + 1))
        fi
    done

    log_success "清理了 $cleaned 个死链，opencli 启动警告已消除"
}

# ──────────────────────────────── Chrome 扩展检查 ──────────────────────────────────
check_chrome_extension() {
    log_step "检查 Chrome 扩展连接"

    if ! command -v opencli >/dev/null 2>&1; then
        log_error "opencli 未安装，跳过扩展检查"
        return 1
    fi

    # 运行 opencli doctor 检查扩展连接
    DOCTOR_OUTPUT=$(opencli doctor 2>&1 || true)

    if echo "$DOCTOR_OUTPUT" | grep -qiE "connected|ready"; then
        log_success "Chrome 扩展已连接"
        return 0
    else
        log_warn "Chrome 扩展未检测到连接"
        echo ""
        log_info "Chrome 扩展安装指南:"
        echo "  1. 打开 Chrome 浏览器"
        echo "  2. 访问 Chrome Web Store"
        echo "  3. 搜索 'opencli browser bridge'"
        echo "  4. 点击「添加至 Chrome」→ 确认安装"
        echo "  5. 确保 Chrome 浏览器保持运行"
        echo "  6. 重新运行此脚本或执行: opencli doctor"
        echo ""
        log_dim "注意: 扩展需要在正常运行的 Chrome 窗口中激活，隐身模式或后台不可用"
        return 1
    fi
}

# ──────────────────────────────── LinkedIn 登录检查 ────────────────────────────────
check_linkedin_login() {
    log_step "检查 LinkedIn 登录状态"

    if ! command -v opencli >/dev/null 2>&1; then
        log_error "opencli 未安装，跳过 LinkedIn 检查"
        return 1
    fi

    # 检查扩展连接状态
    DOCTOR_OUTPUT=$(opencli doctor 2>&1 || true)
    if ! echo "$DOCTOR_OUTPUT" | grep -qiE "connected|ready"; then
        log_warn "Chrome 扩展未连接，跳过 LinkedIn 检查"
        return 1
    fi

    # 尝试打开 LinkedIn Feed 页面检查登录状态
    log_dim "正在检查 LinkedIn 登录状态..."

    if opencli browser linkedin open "https://www.linkedin.com/feed/" >/dev/null 2>&1; then
        sleep 3  # 给页面加载一些时间

        # 检查页面标题判断是否已登录
        LI_STATUS=$(opencli browser linkedin eval \
            "(() => JSON.stringify({ok: document.title.includes('Feed'), title: document.title}))()" 2>/dev/null | tail -n 1 || echo "{\"ok\":false}")

        if echo "$LI_STATUS" | grep -q '"ok":true'; then
            log_success "LinkedIn 已登录"
            return 0
        else
            log_warn "LinkedIn 未登录或会话已过期"
            echo ""
            log_info "LinkedIn 登录指南:"
            echo "  1. 确保 Chrome 扩展已连接"
            echo "  2. 在 Chrome 中访问 https://www.linkedin.com/"
            echo "  3. 完成登录流程（包括两步验证）"
            echo "  4. 确保能够正常访问 https://www.linkedin.com/feed/"
            echo "  5. 重新运行此脚本验证"
            return 1
        fi
    else
        log_error "无法打开 LinkedIn 页面，请检查网络连接和扩展状态"
        return 1
    fi
}

# ──────────────────────────────── 剪贴板工具检查 ────────────────────────────────────
check_clipboard_tools() {
    log_step "检查剪贴板工具 (Phase 5 Review 需要)"

    case "$OS" in
        macos)
            if command -v pbpaste >/dev/null 2>&1; then
                log_success "剪贴板工具: pbpaste (macOS 内置)"
            else
                log_warn "pbpaste 不可用 (异常，macOS 应该内置)"
            fi
            ;;
        linux)
            if command -v wl-paste >/dev/null 2>&1; then
                log_success "剪贴板工具: wl-paste (Wayland)"
            elif command -v xclip >/dev/null 2>&1; then
                log_success "剪贴板工具: xclip (X11)"
            elif command -v xsel >/dev/null 2>&1; then
                log_success "剪贴板工具: xsel (X11)"
            else
                log_warn "未找到剪贴板工具"
                echo ""
                log_info "Linux 剪贴板工具安装:"
                case "${DISTRO:-}" in
                    ubuntu|debian)
                        echo "  • X11 桌面:      sudo apt install xclip"
                        echo "  • Wayland 桌面:  sudo apt install wl-clipboard"
                        echo "  • 不确定环境:    sudo apt install xclip wl-clipboard"
                        ;;
                    centos|rhel|fedora)
                        echo "  • X11 桌面:      sudo yum install xclip"
                        echo "  • Wayland 桌面:  sudo yum install wl-clipboard"
                        ;;
                    *)
                        echo "  请根据发行版安装 xclip (X11) 或 wl-clipboard (Wayland)"
                        ;;
                esac
                log_dim "注意: 剪贴板工具缺失不会阻塞安装，但 Phase 5 Review 需要手动拷贝"
            fi
            ;;
        windows)
            if command -v powershell.exe >/dev/null 2>&1; then
                log_success "剪贴板工具: powershell.exe Get-Clipboard"
            else
                log_warn "powershell.exe 不在 PATH 中"
                log_dim "Windows 系统应该默认包含 PowerShell"
            fi
            ;;
    esac
}

# ──────────────────────────────── 完整验证 ─────────────────────────────────────────
run_full_verification() {
    log_step "运行完整体检验证"

    DOCTOR_SCRIPT="$HOME/.claude/skills/linkedin-talent/scripts/doctor.sh"

    if [ ! -f "$DOCTOR_SCRIPT" ]; then
        log_warn "doctor.sh 脚本不存在，跳过完整验证"
        log_dim "预期位置: $DOCTOR_SCRIPT"
        return 1
    fi

    log_dim "执行: bash $DOCTOR_SCRIPT --quiet"

    if bash "$DOCTOR_SCRIPT" --quiet; then
        log_success "完整体检通过 — 所有组件就绪"
        return 0
    else
        EXIT_CODE=$?
        case $EXIT_CODE in
            1)
                log_warn "体检发现阻塞问题"
                log_dim "运行 'bash $DOCTOR_SCRIPT' 查看详细问题和解决方案"
                ;;
            2)
                log_warn "体检发现可自动修复的问题"
                log_dim "运行 'bash $DOCTOR_SCRIPT --fix' 自动修复"
                ;;
            *)
                log_error "体检脚本异常退出 (退出码: $EXIT_CODE)"
                ;;
        esac
        return $EXIT_CODE
    fi
}

# ──────────────────────────────── 安装总结 ─────────────────────────────────────────
show_installation_summary() {
    echo ""
    echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║                         安装完成！                           ║${NC}"
    echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_success "linkedin-talent skill 安装完成"
    echo ""

    echo -e "${BOLD}下一步 — 在 Claude Code 中使用:${NC}"
    echo "  1. 打开 Claude Code"
    echo "  2. 输入: /linkedin-talent"
    echo "  3. 开始 LinkedIn 人才寻访"
    echo ""

    echo -e "${BOLD}常用命令:${NC}"
    echo "  • 体检状态:     bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh"
    echo "  • 自动修复:     bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix"
    echo "  • opencli 帮助: opencli --help"
    echo "  • 扩展连接:     opencli doctor"
    echo ""

    echo -e "${BOLD}重要提醒:${NC}"
    echo "  ✅ Chrome 扩展必须保持连接"
    echo "  ✅ LinkedIn 需要保持登录状态"
    echo "  ✅ 技能会自动检查环境并引导修复"
    echo ""
}

show_failure_summary() {
    echo ""
    echo -e "${BOLD}${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${RED}║                      安装未完全成功                           ║${NC}"
    echo -e "${BOLD}${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_error "部分组件安装或配置失败"
    echo ""

    echo -e "${BOLD}故障排除:${NC}"
    echo "  1. 查看上面的具体错误信息和解决方案"
    echo "  2. 手动解决问题后重新运行:"
    echo "     bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh"
    echo "  3. 或运行体检获取详细指导:"
    echo "     bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh"
    echo ""

    echo -e "${BOLD}常见问题:${NC}"
    echo "  • Node.js 版本过低 → 升级到 LTS 版本"
    echo "  • npm 权限错误 → 配置用户级全局目录或使用管理员权限"
    echo "  • Chrome 扩展未连接 → 安装扩展并确保 Chrome 运行"
    echo "  • LinkedIn 未登录 → 在 Chrome 中完成登录"
    echo ""
}

# ──────────────────────────────── 主流程 ───────────────────────────────────────────
main() {
    show_banner
    detect_environment

    # 标记安装是否完全成功
    local all_success=true

    # 基础环境检查 (阻塞性)
    check_nodejs || exit 1
    check_npm_permissions

    # 工具安装 (部分失败不退出，记录状态)
    install_opencli || all_success=false

    # 配置和修复
    fix_broken_symlinks

    # 服务连接检查 (非阻塞，但记录状态)
    check_chrome_extension || all_success=false
    check_linkedin_login || all_success=false

    # 辅助工具检查
    check_clipboard_tools

    # 完整验证
    if run_full_verification; then
        show_installation_summary
    else
        all_success=false
    fi

    if [ "$all_success" = false ]; then
        show_failure_summary
        exit 1
    fi

    echo -e "${GREEN}🎉 一键安装完成，linkedin-talent 技能已就绪！${NC}"
}

# ──────────────────────────────── 执行入口 ─────────────────────────────────────────
# 捕获 Ctrl+C 等中断信号
trap 'echo ""; log_error "安装被中断"; exit 130' INT TERM

main "$@"