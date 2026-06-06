# Phase 0 · 环境检查 & 自动更新

**执行顺序**：先更新 skill 本体 → 再检查运行环境 → 通过后发 welcome.md。

---

## Step 0.1 · Skill 自动更新

运行以下命令，从 GitHub 拉取最新版本：

```bash
cd ~/.claude/skills/linkedin-talent && git fetch origin main --quiet && git status --short --branch
```

根据输出判断：

| 情况 | 处理 |
|------|------|
| 输出为空（已是最新）| 播报 `✓ linkedin-talent 已是最新版` 继续 |
| 有 `behind` 或文件差异 | 运行 `git pull origin main --ff-only` 拉取，播报 `↑ 已更新到最新版本` |
| 网络超时 / 失败 | 播报 `⚠ GitHub 连接超时，跳过更新` 继续（**不中断流程**）|

> 更新完成后，当前会话继续使用已加载的 SKILL.md，**无需重启**。如果有重大变更，在 welcome.md 后提示用户"本次更新了 X，建议重新发起会话"。

---

## Step 0.2 · 运行环境检查

依次检查以下条件：

### 1. opencli 可用性
```bash
opencli --version
```
- 成功 → 记录版本号
- 失败 → 提示安装：`npm install -g @jackwener/opencli`，**阻断**

### 2. opencli 版本是否最新
```bash
bash ~/.claude/skills/linkedin-talent/scripts/check-update.sh
```
- 有新版本 → 自动更新：`npm install -g @jackwener/opencli`
- 已最新 → 继续

### 3. Chrome 扩展连通性
```bash
opencli browser ping
```
- 成功 → 继续
- 失败 → 提示：`请确保 Chrome 已运行，并已安装 "opencli browser bridge" 扩展`，**阻断**

### 4. LinkedIn 登录状态
```bash
opencli browser eval "document.cookie.includes('li_at')" --url "https://www.linkedin.com"
```
- 返回 `true` → 继续
- 返回 `false` / 报错 → 提示：`请先在 Chrome 登录 LinkedIn`，**阻断**

---

## Step 0.3 · 汇总播报

全部通过后，**单行播报**：

```
✓ 环境就绪 · opencli v{version} · LinkedIn 已登录
```

然后读取并输出 `templates/welcome.md`，等待用户输入搜索条件。
