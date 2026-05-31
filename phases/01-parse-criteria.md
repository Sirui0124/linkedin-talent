# Phase 1 · 解读用户标准

把用户输入拆解成三层结构，输出"解析镜像"等用户校对，**确认后**才能进入 Phase 1.5。

## 1.1 三层结构（搜索 → 硬筛 → 评分，职责互不重叠）

| 层 | 目标 | 字段 | 实现 |
|---|------|------|------|
| L1 搜索 | 把候选池缩到 ~200 | `search_keywords` + `target_companies` | LinkedIn Voyager API |
| L2 硬筛 | 去掉方向完全不沾的人（确定性 yes/no） | `hard_filters` | 字符串规则匹配 |
| L3 LLM 评分 | 通过硬筛者按维度排序 | `scoring_dimensions`（来自 `lib/scoring-dimensions.json`） | Claude / subagent |

**关键原则**：搜索关键词要少而精；筛选条件要全；细微区分交给 LLM 评分。

## 1.2 字段定义

```yaml
topic_specific: string     # L0 真实课题（含所有限定词，仅内部）

target_companies:          # L1
  - {name: TSMC,  priority: 1}
  - {name: Intel, priority: 2}

search_keywords:           # L1，2-4 个最强信号短语
  primary: ["BEOL"]        # 必跑（含 currentCompany + pastCompany × 每个目标公司）
  secondary: ["Ruthenium"] # 必跑（无公司过滤兜底）
  fallback: ["interconnect", "metallization"]  # 前两轮 < 50 人才跑

hard_filters:              # L2
  any_of_companies: [{name: TSMC, tier_priority: 1}, {name: Intel, tier_priority: 1}]
  allow_other_companies: true
  must_have_any_kw: ["BEOL", "interconnect", "metallization", "Ruthenium", "advanced node", "2nm", "process integration"]
  must_not_have_any_kw: ["marketing", "sales", "HR"]
  title_must_match_any: ["Process Integration", "BEOL", "Interconnect", "Device", "Materials", "Metallization", "Advanced Node"]
  recent_departure_months: 6

scoring_dimensions:        # L3，3-5 个维度（参见 lib/scoring-dimensions.json）
  - {key: company_match,  label: 公司匹配,    weight: 0.30, description: "..."}
  - {key: topic_depth,    label: 课题深度,    weight: 0.30, description: "..."}
  - {key: seniority_focus, label: 资历与聚焦度, weight: 0.25, description: "..."}
  - {key: bonus,          label: 加分项,      weight: 0.15, description: "..."}
```

## 1.3 解析约定（关键，影响精准度）

### `topic_specific`
保留用户原文中的所有限定词（"2nm"、"future industry usage"、"Ruthenium"），不要简化为"半导体"。

### `search_keywords` 选词（最关键）
- **primary**：用户输入中**最独特、最专业、最少见**的 1-2 个短语。判断标准：扔到 LinkedIn 上命中的人是否绝大多数都和课题相关。"BEOL" 是；"engineer" 不是。
- **secondary**：课题独有的实体名词，必跑。"Ruthenium" 这种元素名是典型。
- **fallback**：稍微宽一点的相关词，仅在前两轮总召回 < 50 人时启用。
- **绝不进搜索**：泛行业词（"semiconductor"）、节点名（"2nm"）、抽象概念（"process integration"）。这些下沉到 `hard_filters.must_have_any_kw`。

### `target_companies`
priority 严格按用户文本顺序。"其他公司也可考虑" → `allow_other_companies: true`。

### `hard_filters.must_have_any_kw`
把用户列出的所有关键词放进来（包括没进搜索的），逻辑 OR。这层保证用户提到的关键词全都生效。

### `hard_filters.must_not_have_any_kw`
**默认空**。不要无脑塞 marketing/sales/HR — 用户没说要排除就不要排除。

但**应主动判断**：用户给的关键词或公司，是否会高概率把无关人群拉进来？有真实混淆风险才填，并在镜像里说明加它的理由，让用户决定是否保留：
- 同名歧义：例如搜 "Apple" 找硬件工程师，可能命中大量 retail / genius bar — 建议排除 retail/store
- 关键词跨行业：例如 "machine learning" 同时命中 marketing/growth — 若用户要的是 research，建议排除 marketing
- 课题是技术深度型，但 title 词容易匹配到周边角色（如 BD / sourcing / recruiter / TPM 误命中 "engineer"）

判断不出明显风险就留空。**宁可漏排除，也不要替用户做没说过的决定**。

### `hard_filters.title_must_match_any`
由 target_roles 派生。模糊匹配（contains，大小写不敏感）。

### `scoring_dimensions`
**关键改动 vs 旧版**：把 `soft_criteria`（一段自然语言）拆成 3-5 个维度，每维度独立打分 0-100，加权得总分。便于查看每人在哪个维度强/弱，以及未来调整权重。

参考 `lib/scoring-dimensions.json` 的 schema 与示例：
- `company_match` / `topic_depth` / `target_role_duration` 是岗位寻访默认三维
- 加分维度（`bonus`）建议权重 ≤ 0.15
- 权重之和必须为 1.0（解析时校验，否则归一化）
- 维度命名直接抄录用户原文中的"理想画像"段落，不要 Claude 自行扩充

**默认评分原则（非常重要）**：
- L2 硬筛只判断"有没有命中"，L3/L2.5 排序必须判断"命中质量"。
- 当用户只给了公司 + 岗位（例如"阿里巴巴 Data Analyst"），不要用"可触达度"这类模糊维度填空；默认第三项必须是 `target_role_duration`（目标公司 + 目标岗位累计时长），建议权重 0.35-0.50。
- 目标公司/岗位刚开始、只有当年经历、短期实习、起止年缺失，都要在 `target_role_duration` 降权；不能因为公司和 title 命中就给高总分。
- `reasoning` 和 `highlight_for_outreach` 应优先引用目标公司/目标岗位那段经历；若 Profile 第一段是其他公司/岗位，只能作为"当前展示"补充说明。

### `recent_departure_months`
"近 6 个月"/"近半年"/"recent" → 6；"近 1 年" → 12；"近 18 个月" → 18。

## 1.4 输出解析镜像

按 `templates/parse-mirror.md` 的骨架渲染，完整示例参见 `templates/parse-mirror-example.md`。

**禁止**在输出镜像前调用搜索 API。**禁止**在用户回复"确认"前进入 Phase 1.5。

## 1.5 边界场景

| 场景 | 处理 |
|---|---|
| 只有 Project 描述 | Claude 抽取草案三层放进镜像，让用户增删改 |
| 关键词全部太泛 | 镜像里说明"建议补充 1-2 个独特术语；或我把它们都放进硬筛" |
| 关键词太多 (>10) | 主动归类：哪些进 search.primary（最专业）、哪些进 hard_filters.must_have |
| "任何半导体大厂" | 反问"建议优先级靠前的 3 家" |
| 中英文混合 | 英文术语原样保留 |
| 多个并列课题 | 提示拆成两批跑 |
