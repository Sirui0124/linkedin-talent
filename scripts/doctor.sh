#!/usr/bin/env bash
# linkedin-talent 一站式体检 / 修复
#
# 用法:
#   ./doctor.sh           只检查，列出问题和修复命令
#   ./doctor.sh --fix     自动修复能修的（重建死掉的 symlink、安装 opencli 等）
#   ./doctor.sh --quiet   只输出汇总（适合 CI / Phase 0 内部调用）
#
# 退出码:
#   0  全部通过
#   1  有阻塞问题（用户必须人工处理，比如未登录 LinkedIn）
#   2  有可自动修复的问题但没加 --fix

FIX=false
QUIET=false
for arg in "$@"; do
    case "$arg" in
        --fix)   FIX=true ;;
        --quiet) QUIET=true ;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

ok()    { $QUIET || echo -e "${GREEN}✓${NC} $1"; }
warn()  { $QUIET || echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { $QUIET || echo -e "${RED}✗${NC} $1"; }
info()  { $QUIET || echo -e "${DIM}  $1${NC}"; }

ISSUES=()
FIXABLE=()
BLOCKING=()

# ───────────────────────────── OS / Shell ─────────────────────────────
case "$(uname -s 2>/dev/null)" in
    Darwin)            OS=macos ;;
    Linux)             OS=linux ;;
    MINGW*|MSYS*|CYGWIN*) OS=windows-bash ;;
    *)                 OS=unknown ;;
esac
ok "OS: $OS"

# ───────────────────────────── Node ──────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js 未安装"
    case "$OS" in
        macos)        info "macOS:  brew install node" ;;
        linux)        info "Linux:  https://nodejs.org/ 或 nvm install --lts" ;;
        windows-bash) info "Windows: 从 https://nodejs.org/ 下载安装包" ;;
    esac
    BLOCKING+=("install_node")
else
    NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        fail "Node.js $(node -v) 版本过低（需要 >= 18）"
        BLOCKING+=("upgrade_node")
    else
        ok "Node.js $(node -v)"
    fi
fi

# ───────────────────────────── npm ───────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
    fail "npm 未安装"
    BLOCKING+=("install_npm")
else
    ok "npm $(npm -v)"
fi

# ───────────────────────────── opencli ───────────────────────────────
if ! command -v opencli >/dev/null 2>&1; then
    fail "opencli 未安装"
    FIXABLE+=("install_opencli")
else
    OPENCLI_VER=$(opencli --version 2>/dev/null || echo "?")
    ok "opencli $OPENCLI_VER"
fi

# ───────────────────────────── 死掉的 symlink ─────────────────────────
# opencli 启动时会扫描 ~/.opencli/clis，对每个文件 require()。
# 死链导致 ENOENT 警告刷屏。
CLIS_DIR="$HOME/.opencli/clis"
BROKEN_LINKS=()
if [ -d "$CLIS_DIR" ]; then
    while IFS= read -r f; do
        BROKEN_LINKS+=("$f")
    done < <(find "$CLIS_DIR" -type l ! -exec test -e {} \; -print 2>/dev/null)
fi

if [ ${#BROKEN_LINKS[@]} -eq 0 ]; then
    ok "opencli clis 目录无死链"
else
    warn "发现 ${#BROKEN_LINKS[@]} 个失效 symlink（会刷启动警告，不影响功能）"
    FIXABLE+=("repair_symlinks")
fi

# ───────────────────────────── opencli 扩展 ──────────────────────────
if command -v opencli >/dev/null 2>&1; then
    DOCTOR_OUT=$(opencli doctor 2>&1 || true)
    if echo "$DOCTOR_OUT" | grep -qiE "connected|ready"; then
        ok "Chrome 扩展已连接"
    else
        warn "Chrome 扩展未检测到（运行 opencli doctor 查看详情）"
        info "解决: 1) 安装扩展  2) 启动 Chrome  3) 在扩展弹窗里点连接"
        BLOCKING+=("connect_extension")
    fi
fi

# ───────────────────────────── LinkedIn 登录 ─────────────────────────
if command -v opencli >/dev/null 2>&1 && [[ ! " ${BLOCKING[*]} " =~ " connect_extension " ]]; then
    opencli browser linkedin open "https://www.linkedin.com/feed/" >/dev/null 2>&1 || true
    sleep 2
    LI_STATE=$(opencli browser linkedin eval \
        "(() => JSON.stringify({ok: document.title.includes('Feed')}))()" 2>/dev/null \
        | tail -n 1)
    if echo "$LI_STATE" | grep -q '"ok":true'; then
        ok "LinkedIn 已登录"
    else
        warn "LinkedIn 未登录或会话失效"
        info "解决: 在已连扩展的 Chrome 里打开 linkedin.com 完成登录后重试"
        BLOCKING+=("login_linkedin")
    fi
fi

# ───────────────────────────── 剪贴板工具（Phase 5 review 需要） ─────
case "$OS" in
    macos)
        command -v pbpaste >/dev/null 2>&1 && ok "剪贴板工具: pbpaste" \
            || { warn "pbpaste 不可用（异常，macOS 自带）"; }
        ;;
    linux)
        if command -v wl-paste >/dev/null 2>&1; then ok "剪贴板工具: wl-paste"
        elif command -v xclip   >/dev/null 2>&1; then ok "剪贴板工具: xclip"
        elif command -v xsel    >/dev/null 2>&1; then ok "剪贴板工具: xsel"
        else
            warn "未找到剪贴板工具（Phase 5 需要从浏览器拷贝 JSON 回 Claude）"
            info "Linux 安装: sudo apt install xclip  或  sudo apt install wl-clipboard"
        fi
        ;;
    windows-bash)
        command -v powershell.exe >/dev/null 2>&1 && ok "剪贴板工具: powershell.exe Get-Clipboard" \
            || warn "powershell.exe 不在 PATH，Phase 5 拷贝可能受影响"
        ;;
esac

# ───────────────────────────── 自动修复 ──────────────────────────────
if [ ${#FIXABLE[@]} -gt 0 ] && ! $FIX; then
    echo ""
    warn "可自动修复 ${#FIXABLE[@]} 项: ${FIXABLE[*]}"
    info "运行: $0 --fix"
fi

if $FIX && [ ${#FIXABLE[@]} -gt 0 ]; then
    echo ""
    echo -e "${GREEN}── 开始自动修复 ──${NC}"

    for action in "${FIXABLE[@]}"; do
        case "$action" in
            install_opencli)
                echo "→ 安装 @jackwener/opencli"
                if npm install -g @jackwener/opencli; then
                    ok "opencli 已安装"
                else
                    fail "安装失败 — 检查 npm 权限"
                    BLOCKING+=("install_opencli")
                fi
                ;;

            repair_symlinks)
                echo "→ 重建 ${#BROKEN_LINKS[@]} 个失效 symlink"
                # 候选源根目录（按优先级），第一个找到对应文件就用
                CANDIDATE_ROOTS=(
                    "$HOME/skills/hr-talent-scout-suite/dist/hardened-release"
                    "$HOME/skills/hr-talent-scout-suite"
                )
                FIXED=0
                STILL_BROKEN=0
                for link in "${BROKEN_LINKS[@]}"; do
                    rel="${link#$CLIS_DIR/}"   # e.g. boss/greet.js
                    found=""
                    for root in "${CANDIDATE_ROOTS[@]}"; do
                        if [ -f "$root/clis/$rel" ]; then
                            found="$root/clis/$rel"; break
                        fi
                        # 兼容 hardened-release 之外的扁平结构
                        if [ -f "$root/$rel" ]; then
                            found="$root/$rel"; break
                        fi
                    done
                    if [ -n "$found" ]; then
                        ln -sf "$found" "$link"
                        FIXED=$((FIXED+1))
                    else
                        # 找不到源 → 删掉死链让 opencli 不再扫到它
                        rm -f "$link"
                        STILL_BROKEN=$((STILL_BROKEN+1))
                    fi
                done
                ok "重建 $FIXED 个，删除找不到源的 $STILL_BROKEN 个"
                ;;
        esac
    done
fi

# ───────────────────────────── 汇总 ──────────────────────────────────
echo ""
if [ ${#BLOCKING[@]} -eq 0 ] && [ ${#FIXABLE[@]} -eq 0 ]; then
    echo -e "${GREEN}全部通过 — 可以开始寻访${NC}"
    exit 0
elif [ ${#BLOCKING[@]} -eq 0 ]; then
    if $FIX; then
        echo -e "${GREEN}修复完成 — 重新运行 doctor.sh 确认${NC}"
        exit 0
    fi
    echo -e "${YELLOW}有可自动修复的问题，加 --fix 即可${NC}"
    exit 2
else
    echo -e "${RED}阻塞问题: ${BLOCKING[*]}${NC}"
    echo -e "${DIM}修复以上问题后重新运行 doctor.sh${NC}"
    exit 1
fi
