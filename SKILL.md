---
name: linkedin-talent
description: LinkedIn 人才寻访与建联完整链路。搜索候选人→获取Profile→输出Excel→用户确认→批量发送Connect。通过 opencli browser + Voyager API 实现。触发词：「LinkedIn 找人」「LinkedIn 搜索」「LinkedIn connect」「LinkedIn 加人」「领英寻访」「领英搜索」。
tools: Bash, Read, Write
load: manual
---

# LinkedIn 人才寻访

## ⚡ 启动时必须先执行：自动更新

**每次 skill 被调用，第一件事是拉取最新版本：**

```bash
cd ~/.claude/skills/linkedin-talent && git fetch origin main --quiet 2>/dev/null && git pull origin main --ff-only --quiet 2>/dev/null && echo "✓ 已是最新" || echo "⚠ 网络超时，跳过更新"
```

- 成功拉取 → 播报 `↑ linkedin-talent 已更新`（若有变更）或 `✓ 已是最新版`
- 网络失败 → 播报 `⚠ GitHub 超时，跳过更新` 并**继续执行，不阻断**

---

完整链路 SOP，按 Phase 顺序执行，每个 Phase 都有独立 md 文档，本文件只做编排。

## 文件结构

```
linkedin-talent/
├── SKILL.md                            ← 本文件，编排
├── package.json                        ← 声明 xlsx 依赖（首次安装跑 npm install）
├── phases/
│   ├── 01-parse-criteria.md            解析三层结构（搜索/硬筛/评分）
│   ├── 015-confirm-templates.md        话术与课题确认
│   ├── 02-search-recall.md             搜索召回播报与决策（实现在 lib/voyager.js）
│   ├── 03-filter-and-score.md          L3 LLM 评分指令（L2/L2.5 实现在 phase3 mjs）
│   ├── 05-review.md                    Review HTML + 解析剪贴板 JSON
│   └── 07-dashboard-sync.md            同步 Master Dashboard（伪代码）
├── templates/
│   ├── welcome.md                      开场欢迎语（4 步流程总览）
│   ├── parse-mirror.md                 Phase 1.4 解析镜像渲染骨架
│   ├── parse-mirror-example.md         完整示例（TSMC/Ruthenium）
│   ├── confirm-1-5.md                  Phase 1.5 确认消息渲染骨架
│   ├── broadcast.md                    全程进度播报短句库
│   └── review-dashboard.html           Phase 5 Review HTML 模板
├── lib/
│   ├── paths.js                        ⭐ 路径单一来源（DATA_HOME / batchExcelPath / ...）
│   ├── naming.js                       ⭐ batch_id 生成与解析
│   ├── config.js                       公司ID映射 / 搜索配置 / 错误码
│   ├── voyager.js                      搜索/Profile/Connect 脚本模板（含调用约定）
│   ├── connect-templates.json          sender 身份 + 三种话术模板 + project_config
│   ├── scoring-dimensions.json         L3 评分维度 schema + 示例
│   ├── excel-schema.json               单批次 Excel 列契约（schema-check 校验）
│   ├── dashboard-schema.json           Master Dashboard 列定义
│   └── safety.json                     间隔 / 阈值 / 错误码
└── scripts/
    ├── install-complete.sh             跨平台一键完整安装
    ├── doctor.sh                       环境检查和故障排除（Phase 0）
    ├── data-manager.sh                 数据文件管理工具
    ├── schema-check.mjs                Excel schema 与 phase4 实现一致性校验
    ├── phase3-profile-score.mjs        Phase 3 实现：硬筛 + 规则评分
    ├── phase4-export-excel.mjs         Phase 4 实现：Excel + 固定 Dashboard
    └── check-update.sh                 版本检查
```

数据落盘到 skill 目录内的 `data/`（详见 `lib/paths.js`），并由 `.gitignore` 排除，不同步到 GitHub。

## 执行顺序与停顿点

每个 Phase 都有独立 md，按顺序读取并执行。⏸ 标志表示**必须等用户确认才继续**。

```
Phase 0 · 环境检查        → bash scripts/doctor.sh
   ↓ 退出码:
   ↓   0 = 全部通过  → 发 templates/welcome.md，等用户输入
   ↓   2 = 可自动修复 → 跑 scripts/doctor.sh --fix 后重检
   ↓   1 = 阻塞     → 把 doctor 的提示原文转给用户
Phase 1 · 解析三层结构      → phases/01-parse-criteria.md
   ↓ 输出 templates/parse-mirror.md 骨架（参考 parse-mirror-example.md）
   ⏸ 等用户回 "确认"
Phase 1.5 · 话术确认        → phases/015-confirm-templates.md
   ↓ 输出 templates/confirm-1-5.md 骨架
   ⏸ 等用户回 "确认"
Phase 2 · 搜索召回         → phases/02-search-recall.md（调用 lib/voyager.js searchCandidatesScript）
Phase 3 · Profile + 评分    → bash: node scripts/phase3-profile-score.mjs --batch-id <id>
   · L2 硬筛 + L2.5 规则评分均在 mjs 中实现；
   · ≥50 人触发 subagent 跑 L3 LLM 评分，prompt 与 JSON 契约见 phases/03-filter-and-score.md
Phase 4 · Excel + 话术      → bash: node scripts/phase4-export-excel.mjs --batch-id <id>
   · 列契约见 lib/excel-schema.json；话术模板见 lib/connect-templates.json
Phase 5 · Review Dashboard → phases/05-review.md
   ↓ 自动 open 固定 Dashboard，用户载入当批 Excel
   ⏸ 等用户粘贴 decisions JSON
Phase 6 · 发送 Connect      → 直接调 lib/voyager.js 的 sendConnectScript + parseConnectResult
   · 间隔 6-10s、错误码处理详见 lib/voyager.js 与 lib/safety.json
Phase 7 · Dashboard 同步    → phases/07-dashboard-sync.md（伪代码）
   ↓ 输出最终统计
```

## 三大核心原则

1. **三层职责分离** — 用户标准在 Phase 1 拆成 L1/L2/L3 三层，各层只做一件事，**不越界、不重复**：

   | 层 | Phase | 输入 | 输出 | 做什么 | 不做什么 |
   |---|---|---|---|---|---|
   | **L1 搜索** | 2 | `search_keywords`（2-4 个最强信号词）+ `target_companies` | ~150-250 人候选池（vanity + hits） | 用 LinkedIn API **少而精地召回**；primary/secondary/fallback 分层扩池 | 不做淘汰（不过滤 marketing/HR）；不做排序打分；**泛词不进搜索**（如 "semiconductor"、"2nm"） |
   | **L2 硬筛** | 3 | 完整 Profile + `hard_filters` | 通过 / 未通过 + 原因 | **确定性 yes/no**：公司、必含/排除关键词、title 模糊匹配，全部 AND | 不做强弱比较（"TSMC 现任 vs 其他公司" 留给 L3）；不做 0-100 打分 |
   | **L3 LLM 评分** | 3 | 通过硬筛者 + `scoring_dimensions` | 各维度 0-100 → 加权总分 → Tier 1/2/3 | **多维度排序**：公司匹配、课题深度、资历聚焦等，按权重加权 | 不淘汰明显无关者（那是 L2）；不在搜索阶段用宽词"赌命中率" |

   **关键词分流规则**（Phase 1 解析时执行）：
   - 最独特、最专业的 1-2 个词 → L1 `search_keywords.primary`（如 "BEOL"、"Ruthenium"）
   - 用户列出的其余相关词 → L2 `hard_filters.must_have_any_kw`（如 "2nm"、"process integration"）
   - 用户描述的"理想画像"差异 → L3 `scoring_dimensions`（如"能否就 Ruthenium 量产用量发言"）

   **反模式**（一层不做另一层的事）：
   - ❌ L1 用 10 个泛词搜 → 召回 2000 人，API 浪费、噪声大
   - ❌ L2 写"TSMC 优先 Intel 次之" → 这是排序逻辑，应放 L3 的 `company_match` 维度
   - ❌ L3 用 LLM 判断"是不是 marketing" → 应放 L2 的 `must_not_have_any_kw`
2. **每个 Phase 都有停顿点** — Phase 1 / 1.5 / 5 必须等用户显式确认；其余阶段播报式推进，不要每页报。
3. **播报轻松，不要"工作汇报"** — 动词 + 数字 + 短句，参考 templates/broadcast.md。避免百分比进度条、机械文案。

## 🚀 快速开始

### 一键安装（首次使用）
```bash
# 克隆技能包
git clone [GITHUB_URL] ~/.claude/skills/linkedin-talent

# 一键安装所有依赖
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh
```

### Chrome 扩展
搜索并安装 **"opencli browser bridge"** 扩展，确保 Chrome 保持运行状态。

### 验证安装
```bash
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

看到 `✓ 全部通过 — 可以开始寻访` 即可使用。

## 安全规则速查

完整定义见 `lib/safety.json`。关键阈值：
- 搜索翻页 / Profile 间隔：3-5s 随机
- Connect 发送间隔：6-10s 随机
- subagent 触发：召回 ≥ 50 人
- 遇 401/403/429：**整个阶段立即停止**

## 错误码速查

完整定义见 `lib/safety.json`。关键：
- 200 → 记 invitationUrn
- 400 CANT_RESEND_YET → 跳过
- 400 WEEKLY_INVITATION_LIMIT_EXCEEDED → 整批停止
- 401/403/429 → 立即停止

## 调用模块

- API：`lib/voyager.js`（searchCandidates / getProfile / sendConnect / parseConnectResult / findCompanyId）
- 配置：`lib/config.js`（COMPANY_ID_MAP / DEFAULT_SEARCH_CONFIG / ERROR_CODES）
- 安装：`scripts/install-complete.sh`（跨平台一键安装）
- 体检：`scripts/doctor.sh`（环境检查和故障排除）
