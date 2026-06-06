# Phase 1.4 解析镜像（用户校对版）

把 Phase 1 的结果简洁渲染给用户。只展示用户需要校对的判断：课题与问题、交付方式、目标人群、是否需要先找生态公司，以及详细策略 JSON 的本地路径。内部硬筛、评分权重、排除词等不在默认镜像里展开。

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
我先按下面这个方向拆。请核对，任何一条不对都告诉我：

【课题与问题】（仅内部）
  {topic_specific}
  要回答：
  {for q in research_questions:}
  · {q.ask}

【我的理解】
  锚点公司：{intent.anchor_company}；视角：{intent.view}
  {for a in intent.assumptions:}
  · {a}

【交付模式】
  先做 {delivery_mode.mode}：搜 {delivery_mode.search_pool} 人，给你 {delivery_mode.output_target} 校准；本轮 {delivery_mode.connect_target == "none" ? "不发 Connect" : "Connect 目标：" + delivery_mode.connect_target}。

【目标人群】
  我会依次找这几类专家：
  {for p in personas:}
  {letter}. {p.label}
     能回答：{p.can_answer join ', '}
     搜索词：{p.search_entries join ', '}
     筛选标准：{p.screen}

【Partner / 生态公司】
  {ecosystem_company_discovery.required ? "我会先做一轮公司预研，找出真实 partner / SI / marketplace / implementation 公司，再按这些公司搜人；不会直接把锚点公司当作主要目标公司。" : "不需要单独做生态公司预研。"}
  {for group in ecosystem_company_discovery.company_sets:}
  · {group.label}：{group.names join ', '}；来源：{group.source_hint}

【策略文件】
  详细搜索策略我会存到：{strategy_json_path}
  这是本地 user data，不会同步到 GitHub；Phase 2/3 会按这份 JSON 校验和执行。

如果这些判断没问题，回复"确认"，进入 Phase 1.5。
```

## 规则

- `intent.clarify` 非空时不得输出完整镜像。
- 不要省略"视角"和"目标人群"，这是最容易误搜的地方。
- 目标人群最多展示 2-3 类；每类只写画像、能回答什么、搜索词、筛选标准。
- 不要默认展开硬筛规则、排除词、评分权重；这些是执行内部配置，除非用户要求看。
- partner/channel/supplier/customer 类需求必须明确写出"先找公司，再按公司找人"。
- 必须给出 `strategy_json_path`，格式默认是 `data/criteria/<batchId>.json`。这个文件是本批次详细策略，属于本地 user data，不是 GitHub 同步内容，也不是额外用户交付物。
- 禁止在用户确认前调用搜索 API。
