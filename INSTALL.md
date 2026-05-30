# 安装指南 — linkedin-talent skill

**⚡ 一键安装，支持 Windows/macOS/Linux**

```bash
# 克隆技能包（用户提供 GitHub 链接）
git clone [GITHUB_URL] ~/.claude/skills/linkedin-talent

# 一键完整安装（自动检测操作系统并配置）
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh
```

然后：
1. 在 Chrome 中安装 **"opencli browser bridge"** 扩展
2. 运行 `bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh` 验证

---

## 详细安装指南

完整的跨平台安装指南请参阅：**[INSTALL_COMPLETE.md](INSTALL_COMPLETE.md)**

包含：
- 各操作系统的详细步骤
- Windows 兼容性处理
- 权限问题解决方案
- Chrome 扩展安装指导
- LinkedIn 登录验证
- 故障排除指南

---

## 体检和故障排除

| 项 | 期望 | 失败如何处理 |
|---|---|---|
| **OS** | macOS / Linux / Windows(Git Bash) | 自动识别，仅作上下文 |
| **Node.js** | ≥ 18 | 阻塞，需手动装 |
| **npm** | 任意 | 阻塞，跟随 Node 安装 |
| **opencli** | `npm i -g @jackwener/opencli` | `--fix` 自动装 |
| **opencli clis 死链** | 无 | `--fix` 自动重建或清理 |
| **Chrome 扩展** | 已连接 | 阻塞，需用户在 Chrome 里装扩展 |
| **LinkedIn 登录** | feed 页可访问 | 阻塞，需用户去登录 |
| **剪贴板工具** | mac→pbpaste / linux→xclip|wl-paste / win→powershell | Linux 上需手动装 |

---

## 各操作系统的前置依赖

### macOS

```bash
# 一行装 Node + npm（如果还没装过）
brew install node

# 然后跑 doctor
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix
```

### Linux (Ubuntu/Debian)

```bash
# Node 18+
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# 剪贴板工具（X11 用 xclip，Wayland 用 wl-clipboard）
sudo apt install -y xclip   # 或 sudo apt install -y wl-clipboard

bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix
```

### Windows (Git Bash)

```bash
# 1. 装 Node：从 https://nodejs.org/ 下 LTS 安装包
# 2. 在 Git Bash 里：
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix
```

剪贴板默认走 `powershell.exe Get-Clipboard`，无需额外装。

---

## Chrome 扩展（所有平台都需要）

opencli 通过 Chrome 扩展控制浏览器，必须装一次：

1. 打开 Chrome → 扩展商店搜 **"opencli browser bridge"**
2. 添加到 Chrome → 启用
3. 启动 Chrome 保持运行 → `opencli doctor` 验证连接

---

## LinkedIn 登录

扩展连上之后：

```bash
opencli browser linkedin open "https://www.linkedin.com/feed/"
```

→ 在弹出的 Chrome 标签页里完成登录（含两步验证）。**会话由 Chrome cookie 维持，不用单独存 token。**

---

## 验证

```bash
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

看到 `全部通过 — 可以开始寻访` 即可。

---

## 常见问题

**Q: opencli 启动刷一堆 `ENOENT: no such file or directory` 警告**
A: `~/.opencli/clis/` 下有失效 symlink，跑 `doctor.sh --fix` 会自动重建或清理。

**Q: Chrome 扩展显示已安装但 doctor 说未连接**
A: 扩展必须在「正在运行的 Chrome 窗口」里激活；后台 Chrome、隐身模式、不同用户 profile 都不行。

**Q: LinkedIn 登录后还是 ok=false**
A: feed 页可能因为风控跳到登录页；手动访问 https://www.linkedin.com/feed/ 看是否真的进得去。

**Q: 我有多个 Node 版本（nvm）**
A: 装 opencli 用的是当前 shell 的 node，确认 `which node` 指向 ≥ 18 那个，再装。
