# LinkedIn Talent Scout - 完整安装指南

**一站式安装，支持 Windows/macOS/Linux，用户只需要 GitHub 链接和 Chrome 插件**

## 🚀 快速开始

### 第一步：克隆技能包
```bash
# 用户提供的 GitHub 链接示例
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent
```

### 第二步：一键安装
```bash
# 自动检查并安装所有依赖
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh
```

### 第三步：安装 Chrome 插件
1. 打开 Chrome 浏览器
2. 访问 Chrome Web Store 搜索 **"opencli browser bridge"**
3. 点击「添加至 Chrome」→ 确认安装

### 第四步：验证安装
```bash
# 完整体检，确保所有组件正常
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

看到 `✓ 全部通过 — 可以开始寻访` 即可在 Claude Code 中使用 `/linkedin-talent` 技能。

---

## 📋 详细安装步骤（按操作系统）

### Windows 用户

#### 前置要求
- **Git Bash** 或 **PowerShell**（推荐 Git Bash）
- **Chrome 浏览器**

#### 安装步骤
```bash
# 1. 如果没有 Node.js，先安装（从 https://nodejs.org/ 下载 LTS 版本）
# 2. 在 Git Bash 中执行：

# 克隆技能包
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent

# 运行一键安装脚本（会自动检测 Windows 环境并适配）
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh

# 验证安装
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

#### Windows 特殊处理
- **剪贴板工具**：自动使用 `powershell.exe Get-Clipboard`，无需额外安装
- **路径兼容性**：所有脚本已适配 Windows 路径格式
- **权限问题**：如遇 npm 全局安装权限问题，脚本会自动引导解决方案

### macOS 用户

```bash
# 前置依赖（如果没有 Node.js）
brew install node

# 克隆 + 安装
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh

# 验证
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

### Linux 用户

```bash
# 前置依赖（Ubuntu/Debian 示例）
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# 剪贴板工具（二选一）
sudo apt install -y xclip        # X11 桌面环境
# 或
sudo apt install -y wl-clipboard  # Wayland 桌面环境

# 克隆 + 安装
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh

# 验证
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

---

## 🛠️ 核心依赖说明

### 1. Node.js (>= 18)
**用途**：运行 opencli 浏览器控制工具
**安装方式**：
- Windows: https://nodejs.org/ 下载安装包
- macOS: `brew install node`
- Linux: 使用 NodeSource 官方源或包管理器

### 2. opencli
**用途**：通过 Chrome 扩展控制浏览器进行 LinkedIn 搜索和操作
**安装**：`npm install -g @jackwener/opencli`（一键脚本会自动处理）

### 3. Chrome 扩展 "opencli browser bridge"
**用途**：建立 opencli 与浏览器的通信桥梁
**手动安装**：Chrome Web Store 搜索并添加

### 4. 剪贴板工具
**用途**：Phase 5 Review 阶段从浏览器复制候选人决策数据
**各平台**：
- Windows: `powershell.exe Get-Clipboard`（系统自带）
- macOS: `pbpaste`（系统自带）
- Linux: `xclip` 或 `wl-paste`（需要安装）

---

## 🔧 一键安装脚本详解

新的 `install-complete.sh` 脚本特性：

### 智能环境检测
```bash
# 自动识别操作系统和 Shell 环境
case "$(uname -s)" in
    Darwin)    OS=macos ;;
    Linux)     OS=linux ;;
    MINGW*|MSYS*|CYGWIN*) OS=windows ;;
esac
```

### 依赖项自动安装
- **Node.js 检测**：版本检查 + 安装引导
- **npm 权限处理**：Windows/macOS 权限问题自动处理方案
- **opencli 安装**：包括失败重试机制
- **死链修复**：清理 `~/.opencli/clis/` 中的无效符号链接

### Windows 兼容性优化
- 路径分隔符适配（`/` vs `\`）
- PowerShell 调用标准化
- Git Bash 环境检测和适配
- npm 全局安装权限引导

### 错误处理和恢复
- 分阶段检查，失败时给出具体解决方案
- 部分失败时支持 `--fix` 参数自动修复
- 详细的错误码和退出状态

---

## 🧪 测试和验证

### 完整体检命令
```bash
# 只检查，不修复
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh

# 检查 + 自动修复可修复的问题
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix

# 静默模式（仅输出结果，适合脚本调用）
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --quiet
```

### 体检项目清单
- ✅ **操作系统**：Windows/macOS/Linux 识别
- ✅ **Node.js**：版本 >= 18
- ✅ **npm**：可用性检查
- ✅ **opencli**：安装状态和版本
- ✅ **符号链接**：清理死链，防止启动警告
- ✅ **Chrome 扩展**：连接状态检测
- ✅ **LinkedIn 登录**：会话有效性验证
- ✅ **剪贴板工具**：各平台工具可用性

### 预期输出
```
✓ OS: windows
✓ Node.js v20.11.1
✓ npm 10.2.4
✓ opencli 1.2.3
✓ opencli clis 目录无死链
✓ Chrome 扩展已连接
✓ LinkedIn 已登录
✓ 剪贴板工具: powershell.exe Get-Clipboard

全部通过 — 可以开始寻访
```

---

## 🚨 常见问题解决

### Q: Windows 上 `npm install -g` 报权限错误
**解决方案**：
```bash
# 选项 1: 使用 npm 官方推荐方式（推荐）
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH

# 选项 2: 管理员权限运行 Git Bash
# 右键 Git Bash → "以管理员身份运行"
```

### Q: Chrome 扩展已安装但 doctor 检测不到连接
**检查清单**：
1. Chrome 浏览器正在运行（不能是后台）
2. 扩展已启用（chrome://extensions/ 检查）
3. 不是隐身模式或其他用户配置文件
4. 尝试刷新包含 LinkedIn 的标签页

### Q: LinkedIn 登录检测失败
**可能原因**：
- 会话过期需要重新登录
- 两步验证阻拦
- LinkedIn 反爬机制触发

**解决方案**：
```bash
# 手动打开 LinkedIn Feed 页面完成登录
opencli browser linkedin open "https://www.linkedin.com/feed/"
# 在弹出的 Chrome 标签页中完成登录流程
```

### Q: Linux 上剪贴板工具检测失败
**原因**：X11 和 Wayland 桌面环境需要不同的剪贴板工具

**解决方案**：
```bash
# X11 桌面（如 GNOME on Xorg, KDE Plasma X11）
sudo apt install xclip

# Wayland 桌面（如 GNOME on Wayland, Sway）
sudo apt install wl-clipboard

# 不确定环境的话两个都装
sudo apt install xclip wl-clipboard
```

### Q: Git Bash 中路径问题
**症状**：脚本中的路径在 Windows 下无法正确解析

**解决**：确保使用的是 Git Bash 而不是 Windows CMD，脚本已经做了路径适配处理。

---

## 📦 Claude Code 集成使用

安装完成后，在 Claude Code 中这样使用：

```
用户: /linkedin-talent
Claude: 加载 LinkedIn 人才寻访技能

用户: 帮我找一些 TSMC 的 2nm 工艺工程师
Claude: [启动完整寻访流程]
```

技能会自动：
1. 执行 Phase 0 环境检查
2. 如果有问题，输出具体修复指导
3. 环境正常时进入 7 个 Phase 的完整寻访流程

---

## 🔄 更新和维护

### 更新技能包
```bash
cd ~/.claude/skills/linkedin-talent
git pull origin main
```

### 更新 opencli
```bash
npm update -g @jackwener/opencli
```

### 重新体检（更新后推荐）
```bash
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix
```

---

通过以上完整安装指南，用户只需要提供 GitHub 链接、安装 Chrome 插件，其余所有环境配置都可以通过一键脚本完成，真正做到一站式安装体验。
