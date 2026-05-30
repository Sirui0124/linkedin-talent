# Phase 0 · 环境检查

进入 Phase 1 之前，跑一条命令做完整体检：

```bash
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

doctor 会输出每项 ✓/⚠/✗，并给出退出码：

| 退出码 | 含义 | 下一步 |
|---|---|---|
| 0 | 全部通过 | 进入欢迎语，开始 Phase 1 |
| 2 | 有可自动修复的问题（如失效 symlink、opencli 未装） | **直接跑** `bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh --fix`，再重跑体检 |
| 1 | 有阻塞问题（Node 缺失、扩展未连、LinkedIn 未登录） | 把 doctor 的提示原文转给用户，等用户处理后重试 |

完整安装指南见 `INSTALL.md`（含各 OS 前置依赖、Chrome 扩展、登录步骤）。

---

体检通过后，发出 `templates/welcome.md` 的欢迎语，等用户输入。
