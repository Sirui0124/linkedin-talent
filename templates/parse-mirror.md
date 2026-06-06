# Phase 1.4 解析镜像（用户校对版）

把 Phase 1 的结果简洁渲染给用户。只展示会影响搜索和筛选的判断。

## 若需要先追问

当 `intent.clarify` 非空时，只输出：

```
我需要先确认 {n} 个关键点，因为它们会直接改变搜索人群：

1. {question_1}
   影响：{why_it_changes_search_or_screening}
2. {question_2}
   影响：{why_it_changes_search_or_screening}

你确认后我再把搜索词、筛选标准和评分维度拆出来。
```

## 完整镜像

```
我从你的输入做了如下拆解。请核对，任何一条不对都告诉我：

【真实课题】（仅内部）
  {topic_specific}

【核心假设】
  锚点公司：{intent.anchor_company}
  视角：{intent.view}
  {for a in intent.assumptions:}
  · {a}

【要回答的问题】
  {for q in research_questions:}
  · {q.id}. {q.ask}（{q.must_cover ? "必须覆盖" : "可加分/复核"}）

【交付模式】
  模式：{delivery_mode.mode}
  搜索池：{delivery_mode.search_pool}
  输出目标：{delivery_mode.output_target}
  Connect 目标：{delivery_mode.connect_target}

【目标人群】
  {for p in personas:}
  · {p.label} — priority {p.priority}，目标召回 {p.quota}
    能回答：{p.can_answer join ', '}
    弱项：{p.weak_on join ', '}
    搜索入口：{p.search_entries join ', '}
    筛选证据：{p.screen}

【生态公司发现】
  是否需要：{ecosystem_company_discovery.required ? "是" : "否"}
  {for group in ecosystem_company_discovery.company_sets:}
  · {group.label}：{group.names join ', '}
    来源/待查方向：{group.source_hint}

【搜索配置】
  primary：{search_keywords.primary join ', '}
  secondary：{search_keywords.secondary join ', '}
  fallback：{search_keywords.fallback join ', '}
  目标公司：{target_companies join ', '}

【硬筛规则】
  · 公司/生态：{hard_filters.any_of_companies join ' / '}
  · Title：{hard_filters.title_must_match_any join ' / '}
  · 主题组：
    {for g in hard_filters.topic_groups:}
    - {g.label}（{g.required ? "必需" : "加分/复核"}）：{g.any_kw join ' / '}
  · 排除词：{hard_filters.must_not_have_any_kw join ' / '}（默认空）
  · 时效：{hard_filters.freshness}

【评分维度】
  {for d in scoring_dimensions:}
  · {d.label} (权重 {d.weight}) — {d.description}

【预计调用规模】
  L1 搜索：{search_calls_estimate}
  Profile + 筛选：约 {recall_estimate} 人
  耗时：约 {total_minutes_estimate} 分钟

如果这些判断没问题，回复"确认"，进入 Phase 1.5。
```

## 规则

- `intent.clarify` 非空时不得输出完整镜像。
- 不要省略"视角"和"目标人群"，这是最容易误搜的地方。
- 禁止在用户确认前调用搜索 API。
