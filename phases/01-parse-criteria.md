# Phase 1 · 解读用户标准

目标：把用户需求压缩成一份可执行的搜索配置。先判断"谁能回答"，再配置搜索词和筛选标准。若核心歧义会改变候选池，先问 1-3 个短问题，不进入 Phase 1.5 或搜索。

## 1.1 输出字段

```yaml
topic_specific: string
strategy_json_path: data/criteria/<batchId>.json
saved_strategy_path: data/strategies/<role-or-topic>.json  # 可选，用户要复用某类岗位/课题策略时才写

intent:
  anchor_company: Snowflake              # 被调研的公司/产品方
  view: channel_partners                 # target_internal / channel_partners / both / unclear
  assumptions: ["默认优先找 Snowflake 外部渠道/合作伙伴，原厂员工作补充"]
  clarify: []                            # 必须先问的问题；最多 3 个

delivery_mode:
  mode: calibration                       # calibration / full_run / ask_user
  search_pool: "100-200"                  # calibration: 100-200；full_run: 300-500+
  output_target: "10 profiles"            # calibration: 10；full_run: 50-100
  connect_target: "none"                  # full_run 常见目标：70-80 connects，换取 2-3 个愿意接的人

research_questions:
  - {id: q1, ask: "Q1 consumption 增长情况", must_cover: true}
  - {id: q2, ask: "Q2 增长怎么看", must_cover: true}

personas:
  - label: "Snowflake 外部渠道/合作伙伴"
    priority: 1
    quota: "60-100"
    can_answer: ["q1", "q2", "q3"]
    weak_on: ["原厂正式口径"]
    search_entries: ["<partner_company> Snowflake", "<partner_company> alliance", "<partner_company> data cloud practice"]
    screen: "外部公司经历 + Snowflake GTM/交付/联盟/解决方案证据"

ecosystem_company_discovery:
  required: true
  company_sets:
    - {label: "SI/consulting/cloud partners", names: ["待查"], source_hint: "partner locator / awards / marketplace / case studies"}

target_companies:
  - {name: "Accenture", priority: 1, source: "channel_partner"}
  - {name: "Snowflake", priority: 3, source: "anchor_internal_supplement"}

search_keywords:
  primary: ["Snowflake", "data cloud practice", "partner alliance"]
  secondary: ["Cortex", "Snowpark", "Iceberg"]
  fallback: ["AI Data Cloud", "Snowflake practice"]

hard_filters:
  any_of_companies: ["Accenture", "Deloitte", "AWS", "Snowflake"]
  title_must_match_any: ["Partner", "Alliance", "Sales", "Solution", "Architect", "GTM", "Practice"]
  topic_groups:
    - {label: "Snowflake 相关", required: true, any_kw: ["Snowflake", "AI Data Cloud"]}
    - {label: "Consumption/GTM", required: true, any_kw: ["consumption", "usage", "pipeline", "marketplace", "GTM", "sales"]}
    - {label: "产品覆盖", required: false, any_kw: ["Cortex", "Cortex Code", "Snowflake Intelligence", "Snowpark", "Iceberg"]}
  must_not_have_any_kw: []
  freshness: "当季/下季度问题默认现任或 3-6 个月内离职优先；更久只作补充"

scoring_dimensions:
  - {key: channel_fit, label: "渠道视角", weight: 0.30, description: "是否在外部渠道/合作伙伴侧接触 Snowflake 销售、联盟、交付或 marketplace"}
  - {key: topic_coverage, label: "问题覆盖", weight: 0.35, description: "能覆盖 consumption、Q2 增长、Cortex/Snowflake Intelligence/Snowpark/Iceberg 中的多少项"}
  - {key: freshness, label: "当前性", weight: 0.20, description: "是否现任或近期仍接触 Snowflake 客户/渠道"}
  - {key: seniority, label: "资历", weight: 0.15, description: "是否足够接近客户决策、pipeline 或产品采用反馈"}
```

## 1.2 核心逻辑

### 先拆"要问什么"

- 把用户原文拆成 1-6 个 `research_questions`，保留公司、时间、地域、产品、指标。
- 标出 `must_cover`：必须覆盖的问题影响硬筛和排序；可选问题进入加分或访谈确认。
- 多问题不要混成一个大 OR。像 Snowflake case 里，consumption/GTM 是必需，Cortex/Snowflake Intelligence/Snowpark/Iceberg 是产品覆盖度和加分。

### 再判定"谁能回答"

每个 persona 只保留能用于搜索和筛选的信息：

- `can_answer`: 能回答哪些问题。
- `weak_on`: 不能可靠回答什么，避免排错优先级。
- `search_entries`: 可直接拿去搜的入口。
- `screen`: Profile 上必须看到的证据。

对用户展示时最多保留 2-3 个 persona。完整 `hard_filters`、`scoring_dimensions`、`target_companies`、`search_keywords` 写入 `data/criteria/<batchId>.json`，Phase 1 镜像只给路径，不默认展开。

`data/criteria/` 和 `data/strategies/` 都是本地 user data，不纳入 Git 同步。代码更新后必须继续读取已有 JSON；新增字段只能向后兼容，不能要求旧策略重写。

如果一个人只能讲产品技术但不能讲 consumption，不要排在只做渠道抽样的人前面。最终 3-5 位专家可以分工覆盖所有问题，不要求每人都覆盖全部，除非用户明确要求。

### 决定交付模式和搜索规模

专家访谈转化率低：用户说 "3 channel experts/partners"、"找 3 位专家"、"需要 2-3 个专家" 时，数量是最终访谈目标，不是搜索人数。通常为了拿到 2-3 个愿意接的人，需要 connect 70-80 个专家；而要得到这 70-80 个可 connect 对象，常常要先累计搜索 300-500+ 人。

默认提供两种模式：

- `calibration`: 先搜 100-200 人，返回 10 个高信号 profile 给用户看准确性；适合需求有歧义、第一次跑新领域、需要校准方向。
- `full_run`: 直接搜 300-500+ 人，筛出 50-100 个专家；适合用户已经确认标准，目标是后续 connect 70-80 人，换取 2-3 个有效访谈。

如果用户只说"找 2-3 位专家"或 "3 channel experts/partners"，但没有说明要小样本校准还是一步到位，先问："我理解最终需要 3 位专家。我先给你 10 个待选候选人 shortlist，你确认方向后我再继续扩池，可以吗？"

### 原厂公司 vs 渠道公司

当用户说"X 的销售渠道 / channel / partner / 渠道商"：

- `anchor_company` = X，被调研对象。
- 默认 `view=channel_partners`，优先找外部渠道商、SI、咨询公司、云市场、技术合作伙伴里的 Snowflake 相关负责人。
- X 原厂的 AE/Partner SE/GTM 只作为补充或交叉验证。
- 若用户明确说"X 内部销售/渠道负责人"，才设 `view=target_internal`。
- 若原厂和渠道都要，设 `view=both`，persona 和搜索配额分开。

Snowflake case 的正确理解：Snowflake 是 anchor，不等于候选人必须在 Snowflake。优先找 Snowflake 生态里的 partner/alliance/practice/GTM/solution 人；原厂 Partner SE 可补充，但不应默认排第一。

### Partner / 生态公司需求：先找公司，再找人

当 `intent.view=channel_partners`，或用户说 partner/channel/supplier/customer/reseller/implementation/marketplace：

- Phase 1 必须设 `ecosystem_company_discovery.required=true`。
- 先通过 partner locator、marketplace、case studies、awards、联合新闻稿、招聘 JD、行业榜单找出真实公司池。
- `target_companies` 优先放发现出的外部公司；锚点公司只作为 `source=anchor_internal_supplement` 的补充池。
- L1 primary 应该是 `partner_company × anchor/topic`，例如 `Accenture Snowflake`、`Deloitte Cortex`、`AWS Snowflake marketplace`，而不是单独搜 `Snowflake partner sales`。
- 泛关系词如 `partner`、`channel`、`reseller` 只能和具体公司名或锚点产品组合使用，不能作为主搜索词单独扩池。
- 如果尚未发现公司，Phase 1 镜像要告诉用户"我会先做公司预研"，而不是把锚点公司当作目标公司直接开搜。

### 什么时候必须先问

只问会改变候选池边界的问题，最多 3 个：

- 原厂视角还是外部渠道视角不清楚。
- 是否要求同一位专家覆盖所有问题不清楚。
- 地域/市场范围会影响销售渠道人群。
- 当季/下季度问题是否接受离职较久的人不清楚。
- 目标公司/生态公司名单需要用户指定，否则搜索会过宽。
- 交付模式不清楚：先校准 10 人，还是一步到位 50-100 人。

可合理默认时不要打断，但必须在 `intent.assumptions` 写清楚。

## 1.3 配置搜索词

### 搜索词来源

搜索词从 persona 反推，不照抄用户所有词：

- `primary`: 最能定位人的组合。内部原厂需求通常是公司/技术锚点 + 角色词；partner 需求必须优先是 partner 公司 + anchor/topic，例如 `Accenture Snowflake`、`Deloitte Cortex`。
- `secondary`: 关键产品/技术词，用于补池，例如 `Cortex`、`Snowpark`、`Iceberg`。
- `fallback`: 更宽的生态词，例如 `AI Data Cloud`、`Snowflake practice`。

不要把 `growth`、`feedback`、`consumption` 这类指标词单独当 primary。它们更适合进 `topic_groups` 或评分，因为 LinkedIn 上很少有人把这些词写在 headline 里。

### 目标公司

- `view=channel_partners`: `target_companies` 优先放外部渠道/合作伙伴公司；anchor 公司放补充池。
- `view=target_internal`: `target_companies` 放 anchor 公司。
- `view=both`: 两组公司分开搜，命中记录里区分来源。
- 生态公司未知时先做 `ecosystem_company_discovery`，从 partner locator、marketplace、客户案例、联合新闻稿、奖项、招聘信息里找明确公司名。

## 1.4 配置硬筛和评分

### L2 硬筛

L2 只做确定性判断：

- 公司/生态命中：是否属于目标公司或目标生态。
- Title 命中：是否是 partner、alliance、sales、solution、architect、GTM、practice 等相关角色。
- 主题组命中：`required=true` 的组必须命中；`required=false` 的组不淘汰。
- 排除词默认空。只有明显错位才加，例如 retail、recruiter、student。

注意可拿到的 LinkedIn 字段有限：搜索卡片阶段主要是 `name/headline/location/profile_url/vanity/urn/connectionDegree`；Profile 阶段主要是 `headline/summary/positions/educations/skills`。不要把无法稳定拿到的精确字段写成硬筛条件，例如真实 quota、具体客户 consumption、精确离职月份。

### L3 评分

评分维度控制在 3-4 个，直接对应用户关心的差异：

- 渠道/公司视角是否正确。
- 对核心问题覆盖多少。
- 信息是否新鲜。
- 资历是否足以接触客户、pipeline、产品反馈。

不要用"可触达度"、"知名度"这类和问题无关的维度填空。

## 1.5 输出规则

- `intent.clarify` 非空：只输出要确认的问题和影响，不输出完整镜像，不进 Phase 1.5。
- `intent.clarify` 为空：先把完整执行策略写入 `data/criteria/<batchId>.json`（或在无法写文件时明确给出拟存路径和 JSON 摘要），再按 `templates/parse-mirror.md` 输出简洁解析镜像，等用户确认。
- Phase 1 镜像必须短：课题与问题放最前；交付模式一句话；目标人群 2-3 类；硬筛、评分权重、排除词、完整搜索矩阵不默认展示。
- 若用户希望沉淀某类岗位/课题策略，可另存到 `data/strategies/<role-or-topic>.json`；这仍是 user data，不推送到 GitHub。
- 读取既有策略时必须兼容旧字段：例如 `search_keywords` 与旧 `search`、`prefilter` 与旧 `pre_filter` 均可接受。缺省字段用当前默认规则补齐。
- 禁止在用户确认前调用搜索 API。

## 1.6 边界场景

| 场景 | 处理 |
|---|---|
| 只有 Project 描述 | 先拆 research_questions 和 personas，再给默认假设 |
| "X 的销售渠道/partner" | 默认外部渠道优先；原厂员工作补充 |
| 用户要 2-3 个最终专家，或说 "3 channel experts/partners" | 不代表只搜几十人；默认先问是否返回 10 人 shortlist 校准，再决定 full_run |
| 多问题需求 | 用 topic_groups 分必需/加分，不混成大 OR |
| 不确定是否同一位专家全覆盖 | 先问，或默认多人分工覆盖并写入假设 |
| 当季/下季度经营问题 | 现任或 3-6 个月内离职优先 |
| 地域会影响销售人群 | 先问目标市场 |
| 关键词太多 | 只取 2-4 个做 search，其他进 topic_groups |
