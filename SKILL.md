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
bash ~/.claude/skills/linkedin-talent/scripts/update-skill.sh
```

- 成功拉取 → 播报 `↑ linkedin-talent 已更新`（若有变更）或 `✓ 已是最新版`
- 网络失败 / 本地改动阻止 fast-forward → 播报脚本输出并**继续执行，不阻断**

---

完整链路 SOP。需要主观判断的部分保留为精简 md，实际搜索、Profile 拉取、评分、Excel 导出都走脚本入口。

## 文件结构

```
linkedin-talent/
├── SKILL.md                            ← 本文件，编排
├── package.json                        ← 声明 xlsx 依赖（首次安装跑 npm install）
├── phases/
│   ├── 01-parse-criteria.md            解析三层结构（搜索/硬筛/评分）
│   ├── 02-search-recall.md             搜索脚本契约与边界（实现见 phase2 mjs）
│   ├── 03-filter-and-score.md          L3 LLM 评分指令（L2/L2.5 实现在 phase3 mjs）
│   ├── 05-review.md                    Review HTML + 解析剪贴板 JSON
│   └── 07-dashboard-sync.md            Master Dashboard 脚本契约
├── templates/
│   ├── welcome.md                      开场欢迎语（4 步流程总览）
│   ├── parse-mirror.md                 Phase 1 策略校对渲染骨架
│   ├── parse-mirror-example.md         完整示例（TSMC/Ruthenium）
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
    ├── update-skill.sh                  安全自动更新（ff-only，不覆盖 data/）
    ├── schema-check.mjs                Excel schema 与 phase4 实现一致性校验
    ├── phase2-search-recall.mjs        Phase 2 实现：搜索召回 + 去重 + 原始 JSON
    ├── phase3-profile-score.mjs        Phase 3 实现：硬筛 + 规则评分
    ├── phase4-export-excel.mjs         Phase 4 实现：Excel + 固定 Dashboard
    ├── phase7-sync-dashboard.mjs       Phase 7 实现：同步 Master Dashboard
    └── check-update.sh                 版本检查
```

数据落盘到 `data/`（或 `LINKEDIN_TALENT_HOME` 指定目录，详见 `lib/paths.js`），并由 `.gitignore` 排除，不同步到 GitHub。
`data/strategies/`、`data/criteria/`、`data/exports/`、`data/batches/`、`data/decisions/`、`data/dashboard.xlsx` 都是本地 user data。代码更新只能兼容读取、补建缺失目录、追加新批次；不能覆盖用户策略、历史 Excel、decisions、固定 dashboard 数据。

## 执行顺序与停顿点

⏸ 标志表示**必须等用户确认才继续**。

```
Phase 0 · 环境检查        → bash scripts/doctor.sh
   ↓ 退出码:
   ↓   0 = 全部通过  → 发 templates/welcome.md，等用户输入
   ↓   2 = 可自动修复 → 跑 scripts/doctor.sh --fix 后重检
   ↓   1 = 阻塞     → 把 doctor 的提示原文转给用户
Phase 1 · 策略校对          → phases/01-parse-criteria.md
   ↓ 输出 templates/parse-mirror.md 骨架（参考 parse-mirror-example.md）
   · 接收需求后先做"投资研究调研"预判断：完整明确则直接出方案；会影响研究口径或候选池的关键信息缺失才追问
   · 面向股票投资/专家访谈需求时，追问前先综合推断项目背景：可能在验证哪家公司股票 thesis、收入/设计导入/客户采用/竞争/供应链中的哪类问题，以及为什么这些问题需要哪类专家
   · 若存在会改变候选池的核心歧义，先问 1-3 个短问题，不进入搜索
   · 若判定为 partner/channel/生态视角，必须先完成生态公司预研，给出可直接搜索的 top partner 公司池
   · 同页合并话术轻确认：只确认对外话题、主旨和 1 个参考模板；筛选后再生成逐人话术预览
   ⏸ 等用户回 "确认"
Phase 2 · 搜索召回         → bash: node scripts/phase2-search-recall.mjs --batch-id <id>
   · 用 --dry-run 可先检查搜索计划，不调用 LinkedIn API
Phase 3 · Profile + 评分    → bash: node scripts/phase3-profile-score.mjs --batch-id <id>
   · L2 硬筛 + L2.5 规则评分均在 mjs 中实现；
   · 需要 L3 时，mjs 产出 `phase3_subagent_input_<id>.json`，由 Codex subagent 评分后再执行 `node scripts/phase3-apply-subagent-scores.mjs --batch-id <id> --scores <scores.json>`
   · ≥50 人默认触发 subagent，prompt 与 JSON 契约见 phases/03-filter-and-score.md
Phase 4 · Excel + 话术预览  → bash: node scripts/phase4-export-excel.mjs --batch-id <id>
   · 列契约见 lib/excel-schema.json；话术模板见 lib/connect-templates.json
Phase 5 · Review Dashboard → phases/05-review.md
   ↓ 自动 open 固定 Dashboard，用户载入当批 Excel，确认人选和逐人话术预览
   ⏸ 等用户粘贴 decisions JSON
Phase 6 · 发送 Connect      → 直接调 lib/voyager.js 的 sendConnectScript + parseConnectResult
   · 间隔 6-10s、错误码处理详见 lib/voyager.js 与 lib/safety.json
Phase 7 · Dashboard 同步    → bash: node scripts/phase7-sync-dashboard.mjs --batch-id <id>
   ↓ 输出最终统计
```

## 更新与兼容边界

- 自动更新只运行 `git fetch` + `git pull --ff-only`，目标是更新代码、模板和 schema。
- `data/` 永远是用户本地状态：策略、criteria、raw/phase3 导出、批次 Excel、review decisions、`dashboard.xlsx` 都不得被更新脚本删除、覆盖或提交。
- `templates/review-dashboard.html` 是固定看板模板，可以随代码更新；历史批次 Excel 和 `data/dashboard.xlsx` 不变，继续用新模板打开。
- 新脚本必须从 `lib/paths.js` 和 `lib/naming.js` 取路径，不得硬编码 `data/` 子路径；这样用户迁移到 `LINKEDIN_TALENT_HOME` 后仍能兼容。
- Excel / Dashboard 列变更必须先更新 `lib/excel-schema.json` 或 `lib/dashboard-schema.json`，并保持旧列别名兼容；不允许让旧批次打不开。

## 三大核心原则

1. **三层职责分离** — 用户标准在 Phase 1 拆成 L1/L2/L3 三层，各层只做一件事，**不越界、不重复**：

   | 层 | Phase | 输入 | 输出 | 做什么 | 不做什么 |
   |---|---|---|---|---|---|
   | **L1 搜索** | 2 | `search_keywords`（2-4 个最强信号词）+ `target_companies` | 按 `delivery_mode` 召回：校准 100-200；一步到位 300-500+ | 用 LinkedIn API **少而精地召回**；primary/secondary/fallback 按优先级分层扩池，达标即停 | 不做淘汰（不过滤 marketing/HR）；不做排序打分；**泛词不进搜索**（如 "semiconductor"、"2nm"） |
   | **L2 硬筛** | 3 | 完整 Profile + `hard_filters` | 通过 / 未通过 + 原因 | **确定性 yes/no**：公司、必含/排除关键词、title 模糊匹配，全部 AND | 不做强弱比较（"TSMC 现任 vs 其他公司" 留给 L3）；不做 0-100 打分 |
   | **L3 LLM 评分** | 3 | 通过硬筛者 + `scoring_dimensions` | 各维度 0-100 → 加权总分 → Tier 1/2/3 | **多维度排序**：公司匹配、课题深度、资历聚焦等，按权重加权 | 不淘汰明显无关者（那是 L2）；不在搜索阶段用宽词"赌命中率" |

   **关键词分流规则**（Phase 1 解析时执行）：
   - 先用"投资研究调研"视角做需求完整度预判断：明确研究对象、研究问题、时间范围/市场范围、专家视角和交付目标时，直接出 Phase 1 方案；若缺失项会改变调研口径、目标专家类型、地域/市场范围、公司池或交付规模，先问 1-3 个短问题
   - 用户代表股票投资研究机构或专家访谈项目时，先把短需求翻译成可能的 investment thesis：锚点公司/股票、被验证的业务线、可能的收入或设计导入催化、客户/供应商/竞品关系、需要的证据类型。追问必须先展示这层理解，再问少数会改变候选池的问题。
   - 先拆 `research_questions` 和 `personas`：明确用户要问什么、谁能回答、Profile 上需要什么证据
   - 核心不确定点进入 `intent.clarify`：会改变候选池边界的问题必须先问，不要边猜边搜
   - 先定 `delivery_mode`：用户说 "3 channel experts/partners" 这类数量时，指最终访谈目标人数，不是搜索人数；校准模式搜 100-200 人并返回 10 人，一步到位搜 300-500+ 人并筛 50-100 人，供后续 connect 70-80 人换取 2-3 个有效访谈
   - 开放型专家需求先拆 `personas`：先判断用户真正需要哪几类人，再为每类人设计搜索入口和筛选口径
   - "X 的销售渠道/channel/partner" 先判定 `intent.view`：到底要 X 原厂内部销售/渠道，还是 X 的外部渠道商/合作伙伴公司；不能因为出现 X 就只找 X 员工
   - partner/channel/supplier/customer/construction 类需求先做 `ecosystem_company_discovery`：这是 Phase 1 的背景调研，必须在用户确认前完成；先找出 top 生态/合作伙伴公司，再用公司名找人；泛关系词只做 fallback
   - Phase 1 面向用户只输出精简校对版：投研预判断、课题与问题、交付一句话、2-3 类目标人群、已发现的 partner 公司池、话术主旨和 1 个参考模板、详细策略 JSON 路径。硬筛/权重/完整搜索矩阵写入 `data/criteria/<batchId>.json`，不默认展开。
   - 不要对用户说 "Phase 1.4" / "Phase 1.5" 这类内部编号；用户只需要看到"策略校对"、"搜索"、"名单确认"、"发送"这些自然步骤。
   - 话术确认并入 Phase 1：只确认 sender/rate/对外模糊话题/沟通主旨/一个参考模板。不要在搜索前要求用户二次确认多个话术版本。筛选完成后，Phase 4/5 必须生成逐人 Connect note 预览，用户确认人选和话术后 Phase 6 才能发送。
   - 若 `intent.view=channel_partners` 或 `ecosystem_company_discovery.required=true`，`target_companies` 不得留空或写"待查/TBD"；必须先通过 partner locator、marketplace、case studies、awards、联合新闻稿、招聘 JD、行业榜单等找出真实公司名，并把这些公司名直接写入 L1 搜索关键词（如 `Accenture Salesforce`、`Deloitte Agentforce`）。
   - 多问题需求先建 `hard_filters.topic_groups`，区分必需覆盖和加分/复核；不要把所有词混成一个大 OR
   - 最独特、最专业的 1-2 个词 → L1 `search_keywords.primary`（如 "BEOL"、"Ruthenium"）
   - primary 召回未达标时，才继续跑 `search_keywords.secondary` / `fallback`
   - 用户列出的其余相关词 → L2 `hard_filters.must_have_any_kw`（如 "2nm"、"process integration"）
   - 用户描述的"理想画像"差异 → L3 `scoring_dimensions`（如"能否就 Ruthenium 量产用量发言"）

   **反模式**（一层不做另一层的事）：
   - ❌ L1 用 10 个泛词搜 → 召回 2000 人，API 浪费、噪声大
   - ❌ L2 写"TSMC 优先 Intel 次之" → 这是排序逻辑，应放 L3 的 `company_match` 维度
   - ❌ L3 用 LLM 判断"是不是 marketing" → 应放 L2 的 `must_not_have_any_kw`
2. **关键节点才停顿** — Phase 1 策略校对和 Phase 5 名单/话术确认必须等用户显式确认；其余阶段播报式推进，不要每页报。
3. **播报轻松，不要"工作汇报"** — 动词 + 数字 + 短句，参考 templates/broadcast.md。避免百分比进度条、机械文案。

## 🚀 快速开始

### 一键安装（首次使用）
```bash
# 克隆技能包
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent

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
