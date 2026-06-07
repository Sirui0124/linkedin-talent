# Phase 1 策略校对版（用户确认）

把 Phase 1 的结果简洁渲染给用户。只展示用户需要校对的判断：投研预判断、课题与问题、交付方式、目标人群、已发现的生态公司池、话术主旨和 1 个参考模板，以及详细策略 JSON 的本地路径。内部硬筛、评分权重、排除词等不在默认镜像里展开。

## 若需要先追问

当 `intent.clarify` 非空时，只输出：

```
我的投研背景理解：
{2-4 sentences summarizing likely stock-investment thesis, company relationship, evidence needed, and likely expert pools}

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

【投研预判断】
  {research_precheck.decision == "direct_plan" ? "需求足够明确，直接出方案。" : "需要先确认关键信息。"}
  {research_precheck.research_context}
  判断依据：{research_precheck.rationale}

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
  {ecosystem_company_discovery.required ? "我已先做公司预研，下面这些 partner / SI / marketplace / implementation 公司会直接进入 L1 搜索关键词；不会直接把锚点公司当作主要目标公司。" : "不需要单独做生态公司预研。"}
  {for group in ecosystem_company_discovery.company_sets:}
  · {group.label}：{group.names join ', '}；来源：{group.source_hint}

【沟通话术】
  对外话题：{outreach_plan.topic_obfuscated}
  主旨：{outreach_plan.message_intent}
  参考模板（筛选后会按每位候选人 Profile 个性化）：
    {outreach_plan.reference_connect_note}
  注意：这一步只确认话术方向；名单出来后我会生成逐人话术预览，你确认人选和话术后才会发 Connect。

【策略文件】
  详细搜索策略我会存到：{strategy_json_path}
  这是本地 user data，后续步骤会按这份 JSON 校验和执行。

如果这些判断没问题，回复"确认"，我就开始搜索；不会发任何消息。
```

## 规则

- `intent.clarify` 非空时不得输出完整镜像。
- 完整镜像必须先展示"投研预判断"，说明为什么是直接出方案，而不是先追问。
- 不要省略"视角"和"目标人群"，这是最容易误搜的地方。
- 目标人群最多展示 3-5 类；每类只写画像、能回答什么、搜索词、筛选标准。
- 必须合并展示"沟通话术"轻确认：只放对外话题、主旨、1 个参考模板，以及"筛选后再生成逐人话术预览，确认后才发"的安全说明。
- 不要在用户输出里出现 "Phase 1.4"、"Phase 1.5" 或要求搜索前再单独确认一轮话术。
- 不要默认展开硬筛规则、排除词、评分权重；这些是执行内部配置，除非用户要求看。
- partner/channel/supplier/customer 类需求必须在 Phase 1 先完成公司预研，再明确写出"已找出公司，将按公司找人"。
- `ecosystem_company_discovery.required=true` 时，镜像里不得出现"待查"、`TBD` 或空公司池；必须展示会直接进入搜索关键词的具体公司名。
- 必须给出 `strategy_json_path`，格式默认是 `data/criteria/<batchId>.json`。这个文件是本批次详细策略，属于本地 user data，不是 GitHub 同步内容，也不是额外用户交付物。
- 禁止在用户确认前调用搜索 API。
