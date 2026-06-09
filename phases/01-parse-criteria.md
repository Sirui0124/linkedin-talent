# Phase 1 · 解读用户标准

目标：把用户需求压缩成一份可执行的搜索配置。收到需求后先用"投资研究调研"视角做完整度预判断，再判断"谁能回答"，配置搜索词和筛选标准。若核心歧义会改变研究口径或候选池，先问 1-3 个短问题，不进入搜索。

本文件里的 `strategy_json_path`、`calibration/full_run`、`hard_filters`、`scoring_dimensions`、`L1/L2/L3` 是内部执行术语。面向用户时只说"本地策略文件"、"小样本校准 / 直接扩池"、"基础筛选"、"排序口径 / AI 评分"、"核心搜索词"。

## 1.1 输出字段

```yaml
topic_specific: string
strategy_json_path: data/criteria/<batchId>.json
saved_strategy_path: data/strategies/<role-or-topic>.json  # 可选，用户要复用某类岗位/课题策略时才写

research_precheck:
  decision: direct_plan                    # direct_plan / ask_clarifying_questions
  research_context: "投资研究调研背景下，这是在验证 <anchor_company/topic> 的 <core_thesis_or_business_question>"
  completeness: complete                   # complete / incomplete
  missing_or_ambiguous: []                 # 只列会改变研究口径或候选池的缺失项
  rationale: "研究对象、问题、专家视角、交付目标都足够明确，因此直接出方案"

intent:
  anchor_company: <anchor_company>        # 被调研的公司/产品方
  view: channel_partners                 # target_internal / channel_partners / both / unclear
  assumptions: ["默认优先找 <anchor_company> 外部生态/合作伙伴，原厂员工作补充"]
  clarify: []                            # 必须先问的问题；最多 3 个

delivery_mode:
  mode: calibration                       # 内部值：calibration / full_run / ask_user；对用户说：小样本校准 / 直接扩池
  search_pool: "100-200"                  # 小样本校准: 100-200；直接扩池: 300-500+
  output_target: "10 profiles"            # 小样本校准: 10；直接扩池: 50-100
  connect_target: "none"                  # 直接扩池常见目标：80-100 connects，换取 2-3 个愿意接的人

outreach_plan:
  sender_profile_key: "Zadie"
  rate_range: "$300-800/hr"
  topic_obfuscated: "<externally safe, obfuscated research topic>"
  message_intent: "邀请对方参加 60-min anonymous paid consultation，先索取 personal email 发送正式邀请和 honorarium details"
  template_type: "type2_direct"
  reference_connect_note: "Hi Emma, I'm Zadie at Funda.ai..."
  final_preview_timing: "筛选完成后按每位候选人 Profile 生成逐人话术预览，用户确认后才发 Connect"

research_questions:
  - {id: q1, ask: "<research question 1>", must_cover: true}
  - {id: q2, ask: "<research question 2>", must_cover: true}

must_answer_evidence:
  - "partner pipeline / sampled numbers / customer selection / consumption visibility / marketplace motion"

personas:
  - label: "<anchor_company> 外部渠道/合作伙伴"
    priority: 1
    quota: "60-100"
    can_answer: ["q1", "q2", "q3"]
    weak_on: ["原厂正式口径"]
    search_entries: ["<partner_company> + <LinkedIn-visible role/function>", "<partner_company> + <platform/practice/alliance>", "<anchor_company> + <role/function>"]
    screen: "外部公司经历 + <anchor_company/topic> GTM/交付/联盟/解决方案证据"

ecosystem_company_discovery:
  required: true
  completed_at: "YYYY-MM-DDTHH:mm:ssZ"
  source_urls: ["https://..."]
  company_sets:
    - {label: "SI/consulting/cloud partners", names: ["Accenture", "Deloitte"], source_hint: "partner locator / awards / marketplace / case studies"}

target_companies:
  - {name: "Accenture", priority: 1, source: "channel_partner"}
  - {name: "<anchor_company>", priority: 3, source: "anchor_internal_supplement"}

search_keywords:
  primary: ["<anchor_company + precise role/ecosystem keyword>", "<partner_company + topic_keyword>"]
  secondary: ["<product_or_workload_keyword_1>", "<product_or_workload_keyword_2>"]
  fallback: ["<broader ecosystem keyword>", "<broader role keyword>"]

hard_filters:
  any_of_companies: ["<partner_company_1>", "<partner_company_2>", "<anchor_company>"]
  title_must_match_any: ["Partner", "Alliance", "Sales", "Solution", "Architect", "GTM", "Practice"]
  topic_groups:
    - {label: "锚点相关", required: true, any_kw: ["<anchor_company>", "<anchor_topic>"]}
    - {label: "核心商业问题", required: true, any_kw: ["<business_signal_1>", "<business_signal_2>", "<role_signal>"]}
    - {label: "产品/技术覆盖", required: false, any_kw: ["<product_keyword_1>", "<product_keyword_2>"]}
  must_not_have_any_kw: []
  target_employment:
    mode: "current_or_recent_departure"   # current_only / departed_only / current_or_recent_departure
    accepted_statuses: ["current", "departed_recent"]
    max_years_since_left: 1               # LinkedIn Profile 稳定字段只有年份；月份级窗口写入 notes 供人工复核
    hard_filter: false                    # 默认假设不硬淘汰；用户明确给离职窗口时改 true
    source: "default_assumption"          # default_assumption / user_explicit
    notes: "用户未说明时默认现任或 1 年内离职优先；现任年限久、近期离职加分更多"

scoring_dimensions:
  - {key: channel_fit, label: "渠道/生态视角", weight: 0.30, description: "是否在外部渠道/合作伙伴侧接触 <anchor_company/topic> 的销售、联盟、交付或生态"}
  - {key: topic_coverage, label: "问题覆盖", weight: 0.35, description: "能覆盖用户研究问题中的多少项"}
  - {key: employment_recency, label: "在职/离职窗口", weight: 0.20, description: "是否符合目标公司的在职状态或离职时长要求；默认现任或 1 年内离职优先"}
  - {key: seniority, label: "资历", weight: 0.15, description: "是否足够接近客户决策、pipeline 或产品采用反馈"}
```

## 1.2 核心逻辑

### 先做"投资研究调研"预判断

收到需求后，不要直接机械拆关键词。先把用户需求放到投资研究调研语境里，判断这是在验证什么投资问题、需要什么证据、谁最可能知道答案。

如果用户来自股票投资研究机构、专家访谈、channel check、supplier/customer check 或类似语境，追问前必须先综合理解项目背景：

- 推断锚点公司/股票是谁，以及用户可能在验证哪条投资 thesis。
- 推断问题类型：收入进展、设计导入、客户采用、供应链份额、竞争替代、价格/毛利、产能/交付、产品路线图、合作关系中的哪一种或哪几种。
- 推断关系链：用户提到的公司之间可能是客户、供应商、生态 partner、竞品、内部项目合作，还是仅用于交叉验证。
- 推断最可能有信息的人群：锚点公司内部、客户侧、供应商侧、竞品侧、渠道/生态侧、前员工，分别能回答什么、不能回答什么。
- 只把会改变候选池或筛选口径的疑点拿出来问；不要把已经可以合理默认的投资背景逐条甩给用户确认。

追问输出时要先用 2-4 句写出"我的投研背景理解"，再列问题。问题必须围绕"如果答案不同，我会搜不同的人"。

预判断只产出两种决策：

- `direct_plan`: 需求已经完整明确，直接进入 Phase 1 拆解并输出方案。
- `ask_clarifying_questions`: 缺失或歧义会改变研究口径、目标专家类型、地域/市场范围、目标公司池或交付规模，先问 1-3 个短问题。

判断是否"完整明确"时，看 5 个要素：

- 研究对象：公司、产品、行业或生态锚点是否清楚。
- 研究问题：用户想验证的经营/产品/竞争/渠道/供应链问题是否可拆成 1-6 个问题。
- 时间与市场：季度、年度、地域、客户市场是否足够支持搜索；若会影响候选池则追问。
- 专家视角：需要原厂、竞品、客户、渠道、供应商、前员工还是多方交叉验证是否清楚。
- 交付目标：最终专家数量、校准还是一步到位、是否要 connect 是否足够明确。

追问只问会改变执行边界的问题；不要因为可合理默认的细节打断。若可以默认，写入 `intent.assumptions`，继续出方案。

### 先拆"要问什么"

- 把用户原文拆成 1-6 个 `research_questions`，保留公司、时间、地域、产品、指标。
- 标出 `must_cover`：必须覆盖的问题影响硬筛和排序；可选问题进入加分或访谈确认。
- 多问题不要混成一个大 OR。先区分哪些问题是必须覆盖的主问题，哪些产品/技术/区域/客户问题只是加分或复核。
- 同时补一行 `must_answer_evidence`：用最短的话写清楚"什么证据才能证明这个人真能回答问题"，例如 `partner pipeline`、`sampled numbers`、`customer selection`、`consumption visibility`、`marketplace motion`。后续基础筛选和 AI 评分都围绕这行判断，而不是只看关键词。

### 再判定"谁能回答"

每个 persona 只保留能用于搜索和筛选的信息：

- `can_answer`: 能回答哪些问题。
- `weak_on`: 不能可靠回答什么，避免排错优先级。
- `search_entries`: 可直接拿去搜的 LinkedIn 人才搜索入口，必须像候选人 headline / title / company / skills 里会出现的词，不是 Google/网页预研 query。
- `screen`: Profile 上必须看到的证据。

对用户展示时最多保留 2-3 个 persona。完整 `hard_filters`、`scoring_dimensions`、`target_companies`、`search_keywords` 写入 `data/criteria/<batchId>.json`，策略确认稿只给本地策略文件路径，不默认展开。

`data/criteria/` 和 `data/strategies/` 都是本地 user data，不纳入 Git 同步。代码更新后必须继续读取已有 JSON；新增字段只能向后兼容，不能要求旧策略重写。

如果一个人只能讲产品技术但不能讲 consumption，不要排在只做渠道抽样的人前面。最终 3-5 位专家可以分工覆盖所有问题，不要求每人都覆盖全部，除非用户明确要求。

### 合并话术轻确认

Phase 1 同页确认话术方向，不再单独设置话术确认停顿点。

- 读取 `lib/connect-templates.json`，生成 `outreach_plan`。
- 只展示一个参考模板，默认 `type2_direct`。用户明确要更委婉时，才切到 `type1_friendly`。
- 展示重点是对外模糊话题、sender、rate、沟通主旨和参考模板；不要在搜索前让用户比较多个版本。
- 必须说明：本轮确认后只搜索和生成名单，不发消息；筛选后 Phase 4/5 会生成逐人话术预览，用户确认人选和话术后 Phase 6 才能发 Connect。

### 决定交付模式和搜索规模

专家访谈转化率低：用户说 "2 experts"、"3 channel experts/partners"、"找 3 位专家"、"需要 2-3 个专家" 时，数量是最终成功建联/访谈目标，不是搜索人数、候选名单人数或 Connect 数。通常为了拿到 2-3 个愿意接的人，需要 connect 80-100 个专家；而要得到这 80-100 个可 connect 对象，常常要先累计搜索 300-500+ 人。

默认提供两种模式：

- 内部 `calibration`，对用户说"小样本校准"：先搜 100-200 人，返回 10 个高信号 profile 给用户看准确性；适合需求有歧义、第一次跑新领域、需要校准方向。
- 内部 `full_run`，对用户说"直接扩池"：直接搜 300-500+ 人，筛出 50-100 个专家；适合用户已经确认标准，目标是后续 connect 80-100 人，换取 2-3 个有效访谈。

如果用户只说"找 2-3 位专家"、"2 experts" 或 "3 channel experts/partners"，但没有说明要小样本校准还是一步到位，先按用户原数回显追问："我理解你最终需要 {n} 位成功建联/可约访专家。我先给你 10 个待选候选人 shortlist，你确认方向后我再继续扩池，可以吗？"

### 原厂公司 vs 渠道公司

当用户说"X 的销售渠道 / channel / partner / 渠道商"：

- `anchor_company` = X，被调研对象。
- 默认 `view=channel_partners`，优先找外部渠道商、SI、咨询公司、云市场、技术合作伙伴里的相关负责人。
- X 原厂的 AE/Partner SE/GTM 只作为补充或交叉验证。
- 若用户明确说"X 内部销售/渠道负责人"，才设 `view=target_internal`。
- 若原厂和渠道都要，设 `view=both`，persona 和搜索配额分开。

通用理解：锚点公司是被调研对象，不等于候选人必须在锚点公司。若用户要外部渠道/生态视角，应优先找生态里的 partner/alliance/practice/GTM/solution 人；原厂相关角色可补充，但不应默认排第一。

### Partner / 生态公司需求：先找公司，再找人

当 `intent.view=channel_partners`，或用户说 partner/channel/supplier/customer/reseller/implementation/marketplace：

- Phase 1 必须设 `ecosystem_company_discovery.required=true`。
- 先通过 partner locator、marketplace、case studies、awards、联合新闻稿、招聘 JD、行业榜单找出真实公司池，**再输出策略确认稿给用户确认**。
- 公司预研属于 Phase 1 背景调研，不是 Phase 2 搜索召回；只有 LinkedIn 人才搜索/API 调用必须等用户确认后再开始。
- 策略确认稿里必须展示已经发现的 top partner/company names，并说明这些名字会直接进入核心搜索词。
- `target_companies` 和 `ecosystem_company_discovery.company_sets[].names` 不得用 `"待查"`、`"TBD"`、空数组等占位值；如果资料不足，必须先补调研或向用户说明无法形成可执行公司池。
- `target_companies` 优先放发现出的外部公司；锚点公司只作为 `source=anchor_internal_supplement` 的补充池。
- 核心搜索词应优先是 `partner_company × anchor/topic`，例如 `<SI partner> <anchor company>`、`<consulting partner> <product keyword>`、`<cloud/marketplace partner> <anchor marketplace keyword>`，而不是单独搜 `<anchor company> partner sales`。
- 泛关系词如 `partner`、`channel`、`reseller` 只能和具体公司名或锚点产品组合使用，不能作为主搜索词单独扩池。

### 什么时候必须先问

只问会改变候选池边界的问题，最多 3 个：

- 短需求里的业务线/产品词有多种投研解释，且不同解释会找完全不同的人群。
- 公司之间的关系不清楚：客户采用、供应商供货、合作开发、竞品替代或内部项目进展会对应不同专家池。
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

- 公开预研词和 LinkedIn 搜索词必须分开。公开预研词用于网页搜索、新闻、partner locator、case studies、监管/地方政府页面，目的是发现项目、公司池和证据；LinkedIn 搜索词用于找人，必须改写成候选人 profile 上可能出现的 `公司/机构 + 职能/岗位/设施类型/生态位置`。
- 不要把公开预研 query 原样写进 `search_entries` 或 `search_keywords`。例如 `Nebius construction progress in France and US`、`Nebius Bethune former Bridgestone project`、`Independence Missouri data center approval` 更适合网页预研；LinkedIn 应改成 `Nebius data center`、`Azur Datacenter facilities`、`ARCO mission critical`、`Independence Power & Light interconnection`。
- 当目标公司没有 LinkedIn company ID 映射或很可能找不到 ID 时，优先写 `search_keywords.company_topic_matrix`，按每个公司配置短的 role/function queries；避免把一个长项目短语与所有公司做笛卡尔积。

- `primary`: 最能定位人的组合。内部原厂需求通常是公司/技术锚点 + 角色词；partner 需求必须优先是 `company + role + ecosystem position`，再补 anchor/topic，例如 `<partner company> <anchor company> practice lead`、`<partner company> <product keyword> alliance`、`<reseller> <anchor company> channel sales`。不要一上来只搜一个宽泛公司名或宽泛行业词。
- `secondary`: 关键产品/技术词，用于补池，例如用户问题里的具体产品、平台、工艺、组件、客户、区域或业务线。
- `fallback`: 更宽的生态词，例如行业/平台大类、生态岗位词、实施/迁移/渠道/供应链等关系词。

不要把 `growth`、`feedback`、`consumption` 这类指标词单独当 primary。它们更适合进 `topic_groups` 或评分，因为 LinkedIn 上很少有人把这些词写在 headline 里。

### 目标公司

- `view=channel_partners`: `target_companies` 优先放外部渠道/合作伙伴公司；anchor 公司放补充池。
- `view=target_internal`: `target_companies` 放 anchor 公司。
- `view=both`: 两组公司分开搜，命中记录里区分来源。
- 生态公司未知时在 Phase 1 先做 `ecosystem_company_discovery`，从 partner locator、marketplace、客户案例、联合新闻稿、奖项、招聘信息里找明确公司名；完成后再给用户确认。

## 1.4 配置硬筛和评分

### 基础筛选（内部 L2）

L2 只做确定性判断：

- 公司/生态命中：是否属于目标公司或目标生态。
- Title 命中：是否是 partner、alliance、sales、solution、architect、GTM、practice 等相关角色。
- 主题组命中：`required=true` 的组必须命中；`required=false` 的组不淘汰。
- 排除词默认空。只有明显错位才加，例如 retail、recruiter、student。
- 若 `intent.view=channel_partners`，优先同时看到两类证据：`vendor/topic evidence` + `commercial/channel evidence`。只会产品实施、架构或开发的人可以作为 backup 进入名单，但 AI 评分必须降到 Tier 2/3，并写清楚缺少商业侧证据。
- 在职/离职窗口必须单独解析到 `hard_filters.target_employment`，不要只写进自然语言备注：
  - 用户说"必须在职/现任"：`mode=current_only`、`accepted_statuses=["current"]`、`hard_filter=true`。
  - 用户明确说"离职 N 年/月内"、"近期离职"、"离职 1 年内"：不要再追问，直接 `source=user_explicit`、`hard_filter=true`，并严格遵守 `max_years_since_left`；若是月份级窗口，写入 `notes` 并在名单确认时人工复核。
  - 用户说"只要前员工/希望已离职"：`mode=departed_only`、`accepted_statuses=["departed_recent"]` 或 `["departed_any"]`；若给了具体期限则严格执行；可用 `min_years_since_left` 表示希望不要刚离职。
  - 用户没有提在职状态时，默认写入 `source=default_assumption`、`mode=current_or_recent_departure`、`accepted_statuses=["current","departed_recent"]`、`max_years_since_left=1`、`hard_filter=false`：不硬淘汰，但在 `employment_recency` 维度里让现任、在职时间久、近期离职的人得分更高，离职超过 1 年的人明显降权。
  - 如果项目对时效性高度敏感且默认假设会改变候选池，应在策略校对里用一句话要求用户声明在职/离职窗口；如果用户明确给了窗口，不再追问。

注意可拿到的 LinkedIn 字段有限：搜索卡片阶段主要是 `name/headline/location/profile_url/vanity/urn/connectionDegree`；Profile 阶段主要是 `headline/summary/positions/educations/skills`。不要把无法稳定拿到的精确字段写成硬筛条件，例如真实 quota、具体客户 consumption、精确离职月份。

### AI 评分（内部 L3）

评分维度控制在 3-4 个，直接对应用户关心的差异：

- 渠道/公司视角是否正确。
- 对核心问题覆盖多少。
- 信息是否新鲜。
- 是否符合在职/离职窗口（例如现任、近期离职、离职 1 年内、只看前员工）。
- 资历是否足以接触客户、pipeline、产品反馈。

不要用"可触达度"、"知名度"这类和问题无关的维度填空。

production shortlist 不是只保留完美专家：Tier 1 是能直接回答核心问题的人；Tier 2 是方向正确、可作为补充验证或转介绍入口的人；Tier 3 是弱相关备选。宁可清楚分层，也不要把 backup 伪装成主专家。

## 输出规则

- `intent.clarify` 非空：只输出要确认的问题和影响，不输出完整镜像，不进入搜索。
- `intent.clarify` 为空：先把完整执行策略写入 `data/criteria/<batchId>.json`（或在无法写文件时明确给出拟存路径和 JSON 摘要），再按 `templates/parse-mirror.md` 输出简洁解析镜像，等用户确认。
- 策略确认稿必须短：课题与问题放最前；交付模式一句话；目标人群 2-3 类；基础筛选细则、评分权重、排除词、完整搜索矩阵不默认展示。
- 若用户希望沉淀某类岗位/课题策略，可另存到 `data/strategies/<role-or-topic>.json`；这仍是 user data，不推送到 GitHub。
- 读取既有策略时必须兼容旧字段：例如 `search_keywords` 与旧 `search`、`prefilter` 与旧 `pre_filter` 均可接受。缺省字段用当前默认规则补齐。
- 禁止在用户确认前调用搜索 API。

## 1.6 边界场景

| 场景 | 处理 |
|---|---|
| 只有 Project 描述 | 先拆 research_questions 和 personas，再给默认假设 |
| "X 的销售渠道/partner" | 默认外部渠道优先；原厂员工作补充 |
| 用户要 2-3 个最终专家，或说 "2 experts" / "3 channel experts/partners" | 指最终成功建联/访谈目标，不代表只搜几十人或只 connect 2-3 人；默认先问是否返回 10 人 shortlist 校准，再决定是否扩到 80-100 个 Connect 量级 |
| 多问题需求 | 用 topic_groups 分必需/加分，不混成大 OR |
| 不确定是否同一位专家全覆盖 | 先问，或默认多人分工覆盖并写入假设 |
| 当季/下季度经营问题 | 默认现任或 1 年内离职优先；现任年限久/近期离职加分更多，3-6 个月级别只作人工复核提示 |
| 用户强调在职/离职期限 | 写入 `target_employment`；明确给了离职窗口就 `source=user_explicit` + `hard_filter=true` 严格执行 |
| 地域会影响销售人群 | 先问目标市场 |
| 关键词太多 | 只取 2-4 个做 search，其他进 topic_groups |
