---
name: linkedin-talent
description: LinkedIn 人才寻访与建联完整链路。搜索候选人→获取Profile→输出Excel→用户确认→批量发送Connect。通过 opencli browser + Voyager API 实现。触发词：「LinkedIn 找人」「LinkedIn 搜索」「LinkedIn connect」「LinkedIn 加人」「领英寻访」「领英搜索」。
tools: Bash, Read, Write
load: manual
---

# LinkedIn 人才寻访

完整链路 SOP，按 Phase 顺序执行，每个 Phase 都有独立 md 文档，本文件只做编排。

## 文件结构

```
linkedin-talent/
├── SKILL.md                            ← 本文件，编排
├── phases/
│   ├── 00-preflight.md                 环境检查
│   ├── 01-parse-criteria.md            解析三层结构（搜索/硬筛/评分）
│   ├── 015-confirm-templates.md        话术与课题确认
│   ├── 02-search-recall.md             搜索召回（L1）
│   ├── 03-filter-and-score.md          硬筛 + LLM 多维度评分（L2 + L3，subagent）
│   ├── 04-export-excel.md              单批次 Excel + 话术生成
│   ├── 05-review.md                    Review HTML + 解析剪贴板 JSON
│   ├── 06-send-connect.md              发送 Connect
│   └── 07-dashboard-sync.md            同步 Master Dashboard
├── templates/
│   ├── welcome.md                      开场欢迎语（4 步流程总览）
│   ├── parse-mirror.md                 Phase 1.4 解析镜像渲染骨架
│   ├── parse-mirror-example.md         完整示例（TSMC/Ruthenium）
│   ├── confirm-1-5.md                  Phase 1.5 确认消息渲染骨架
│   └── broadcast.md                    全程进度播报短句库
├── data/                               📁 数据存储目录（新增）
│   ├── batches/                        搜索结果 Excel 文件
│   ├── decisions/                      用户决策 JSON 文件
│   ├── exports/                        最终输出文件
│   └── archive/                        归档文件
├── lib/
│   ├── config.js                       公司ID映射 / 搜索配置
│   ├── voyager.js                      搜索/Profile/Connect 脚本模板
│   ├── connect-templates.json          sender 身份 + 三种话术模板
│   ├── scoring-dimensions.json         L3 评分维度 schema + 示例
│   ├── excel-schema.json               单批次 Excel 列定义
│   ├── dashboard-schema.json           Master Dashboard 列定义
│   ├── data-manager.json               数据管理配置（新增）
│   └── safety.json                     间隔 / 阈值 / 错误码
└── scripts/
    ├── install-complete.sh             跨平台一键完整安装
    ├── doctor.sh                       环境检查和故障排除
    ├── data-manager.sh                 数据文件管理工具（新增）
    └── check-update.sh                 版本检查
```

## 执行顺序与停顿点

每个 Phase 都有独立 md，按顺序读取并执行。⏸ 标志表示**必须等用户确认才继续**。

```
Phase 0 · 环境检查        → phases/00-preflight.md
   ↓ 通过后发 templates/welcome.md，等用户输入
Phase 1 · 解析三层结构      → phases/01-parse-criteria.md
   ↓ 输出 templates/parse-mirror.md 骨架（参考 parse-mirror-example.md）
   ⏸ 等用户回 "确认"
Phase 1.5 · 话术确认        → phases/015-confirm-templates.md
   ↓ 输出 templates/confirm-1-5.md 骨架
   ⏸ 等用户回 "确认"
Phase 2 · 搜索召回         → phases/02-search-recall.md
Phase 3 · Profile + 评分    → phases/03-filter-and-score.md（≥50 启 subagent）
Phase 4 · Excel + 话术      → phases/04-export-excel.md
Phase 5 · Review HTML      → phases/05-review.md
   ↓ 自动 open Review 页
   ⏸ 等用户粘贴 decisions JSON
Phase 6 · 发送 Connect      → phases/06-send-connect.md
Phase 7 · Dashboard 同步    → phases/07-dashboard-sync.md
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
