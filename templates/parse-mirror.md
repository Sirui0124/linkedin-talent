# Phase 1.4 解析镜像（用户校对版）

把 Phase 1 的解析结果按下方骨架渲染回给用户。**完整示例参见 parse-mirror-example.md**。

## 渲染骨架

```
我从你的输入做了如下拆解（搜索 → 硬筛 → 评分三层）。请核对，任何一条不对都告诉我：

【L0 真实课题】（仅内部）
  {topic_specific}

【L1 搜索关键词】（少而精，决定召回池）
  primary（必跑）：    {kw_primary join ', '}
  secondary（必跑）：  {kw_secondary join ', '}
  fallback（不足时）： {kw_fallback join ', '}
  ↳ 不进搜索的词：{excluded_kws join ', '}
    原因：{exclusion_reason 一句话}

【L1 目标公司】
  {for c in target_companies:}
  {c.name} (priority {c.priority}{若 ID 未确认追加 "⚠️ ID 首次校验"})
  允许其他公司：{是 / 否}

【L2 硬筛规则】（全部 AND，确定性 yes/no）
  · 公司命中：{any_of_companies join ' / '}
  · Profile 必含至少一个：{must_have_any_kw join ' / '}
  · Title 必模糊匹配至少一个：{title_must_match_any join ' / '}
  · Profile 不能含：{must_not_have_any_kw join ' / '}（默认空）
  · 近期离职窗口：{recent_departure_months} 个月

【L3 LLM 评分维度】（每维度 0-100，加权得总分）
  {for d in scoring_dimensions:}
  · {d.label} (权重 {d.weight}) — {d.description}

【Tier 分档】
  Tier1 ⭐⭐⭐ = 通过硬筛 + 总分 ≥75
  Tier2 ⭐⭐  = 通过硬筛 + 总分 50-74
  Tier3 ⭐   = 通过硬筛 + 总分 30-49
  排除      = 总分 <30 → Sheet 2

【预计调用规模】
  L1 搜索：{search_calls_estimate}
  L2 硬筛：纯字符串规则，~{recall_estimate} 人 instant
  L3 LLM 评分：通过硬筛 ~{filter_pass_estimate} 人 × {len(dims)} 个维度
  耗时：约 {total_minutes_estimate} 分钟

如果有任何字段需要调整（特别是搜索关键词的取舍 / 评分维度的权重），告诉我；否则回复"确认"，进入 Phase 1.5。
```

## 渲染规则

- 不要省略任何一节，即使某项为空也写"无"
- 评分维度必须显式列出每个维度的 label / weight / description，让用户能直接调整权重
- "⚠️ ID 首次校验" 仅当 `target_companies[i].id == null` 时追加
- 调用规模估算格式参考 phases/02-search-recall.md 中的"调用矩阵示例"

## 禁止

- **禁止**在输出镜像前直接调用搜索 API
- **禁止**在用户回复"确认"前进入 Phase 1.5
- **禁止**Claude 自行扩充 soft_criteria 或评分维度，必须从用户原文提炼
