# Phase 3 · Profile + 硬筛 + 评分（L2 + L2.5 + L3）

**实现入口**：`bash node scripts/phase3-profile-score.mjs --batch-id <id>`

mjs 已实现：
- **3.0 预筛**（无 API，基于 headline + hits）—— `preFilter()`
- **3.0b Profile 拉取**（间隔由 `humanDelay()` 控制，模拟人类停顿）—— `getProfileScript()`
- **3.1 L2 硬筛**（公司 / 必含词 / 排除词 / title 模糊匹配，全部 AND，宽松策略）—— `hardFilter()`
- **3.1b L2.5 规则评分**（按 `scoring_dimensions.key` 路由：`company_match` / `topic_depth` / `target_role_duration`/`seniority_focus` / `bonus`）—— `ruleScore()`
- **断点续跑** `--resume <partial.json>`、定期写中间结果（每 10 人）
- **错误码**：401/403/429 → 整批立即停止；其他非 200 仅丢弃单人

本文件**只描述需要 LLM 推理的部分**——即 L3 评分（subagent 模式）与最终 JSON 契约。

## 何时启用 L3 LLM 评分

- 触发阈值：通过 L2 硬筛人数 ≥ `safety.subagent_trigger_threshold`（默认 50）→ 用 subagent 跑 L3
- 下方 50 人：直接用 mjs 的规则评分结果（`scored_by="rule"`），跳过 LLM
- L2.5 规则分流（可选优化）：rule_score ≥ 80 直接 Tier 1；≤ 25 直接 Tier 3；中间段 26-79 才进 L3 —— 可减少 LLM 调用 ~35%

## L3 评分 prompt 模板（每人一次调用）

```
你是 LinkedIn 候选人评分员。基于下方维度逐项打分（0-100）。

【评分维度】
{for d in scoring_dimensions:}
- {d.key} ({d.label}, 权重 {d.weight}) — {d.description}

【单维度评分参考】
100 = 完美匹配（头部）；75 = 明显匹配；50 = 部分匹配；25 = 弱匹配；0 = 完全不沾

【核心排序原则】
- 硬筛命中不等于高分。L2 已确认"有目标公司/岗位信号"后，L3 必须继续判断命中质量。
- 岗位寻访默认必须评估目标公司 + 目标岗位累计时长（`target_role_duration` 或语义等价物）。
- 目标岗时长短、刚入职、仅实习、起止年缺失，应降权；不能因为 company_match 和 topic_depth 都命中就直接给高总分。
- reasoning / highlight_for_outreach 优先引用最相关的目标公司目标岗位经历，不要默认取第一段当前经历。

【候选人 Profile】
姓名：{firstName} {lastName}
当前职位：{current_title} @ {current_company}
经历：{positions_text}             ← 每段 "公司 | 职位 | 起止年 | 描述前150字"
学历：{educations_text}
技能：{skills}
摘要：{summary[:500]}
搜索命中信号：{hits_summary}       ← e.g. "BEOL@TSMC current + kw:Ruthenium"

【输出 JSON】
{
  "scores_breakdown": [
    {"key": "company_match",  "score": 90},
    {"key": "topic_depth",    "score": 75},
    {"key": "target_role_duration", "score": 80},
    {"key": "bonus",           "score": 50}
  ],
  "score": <round(weighted_sum)>,    // 由 scores_breakdown × weights 加权得到
  "tier": <1|2|3|0>,                 // ≥75 → 1, 50-74 → 2, 30-49 → 3, <30 → 0(排除)
  "reasoning": "<1-2 句中文，说明打分主因>",
  "matched_signals": ["...", "..."],
  "missed_signals": ["...", "..."],
  "highlight_for_outreach": "<1 句话，最适合放进 connect note 的个性化亮点>"
}
```

### 关键约束

- 评分必须严格基于用户原文定义的 `scoring_dimensions`，不要 Claude 自行扩充维度
- `scores_breakdown` 数组顺序与 `scoring_dimensions` 一致；Excel D 列把它渲染为 `公司:90 / 岗位:75 / 目标岗时长:80 / 加分:50`
- `highlight_for_outreach` 直接复用到 Phase 4 的 `{highlight}` 变量，避免双重生成
- Profile 异常残缺 → score=null，对应"待人工核验"

## 目标岗时长评分口径

用于岗位寻访、公司岗位组合寻访（例如 Alibaba Data Analyst、Tencent Overseas Publishing、TSMC BEOL Engineer）。

```text
目标岗时长 = sum(经历中同时命中 target company 和 target role/title 的年限)

100: >=5 年
85 : >=3 年且 <5 年
70 : >=2 年且 <3 年
45 : >=1 年且 <2 年
25 : <1 年但有明确起止时间
40 : 命中目标公司/目标岗但缺少 startYear，保守中低分并待人工复核
0  : 无可计算目标岗时长，或只显示未来/当年刚开始
```

## Subagent 模式（≥50 人触发）

### 职责

1. 接收：候选人列表（已通过 L2.5 中间段）+ scoring_dimensions + project_config
2. 对每人跑 L3 LLM 评分
3. 合并回 phase3 输出 JSON

### Subagent prompt 框架

```
你是 LinkedIn 候选人评分 agent。

任务：对 {N} 个候选人，逐人跑 L3 LLM 评分（按下方 scoring_dimensions），
     返回与单人 prompt 相同的 JSON 数组。

【scoring_dimensions】 {scoring_dimensions_json}
【project_config】 {project_config_json}（仅供 highlight 生成参考）
【候选人列表（含已拉取的 profile）】 {candidates_json}

约束：
- 评分严格基于 scoring_dimensions，不要自行扩充维度
- highlight_for_outreach 必填，复用规则见 lib/connect-templates.json
```

### 模型路由

优先级 `claude-haiku-4-5-20251001` > `claude-sonnet-4-6` > 主模型 fallback；通过 `Agent({ subagent_type: "general-purpose", model: "..." })` 指定。

## Tier 计算

```python
def compute_final_tier(score):
    if score is None: return 'pending'
    if score < 30:    return 0   # 排除 → Sheet2
    if score >= 75:   return 1
    if score >= 50:   return 2
    return 3
```

## 候选人最终 JSON 结构（phase3 输出，phase4 消费）

```json
{
  "vanity": "...", "urn": "urn:li:fsd_profile:...", "profile_url": "...",
  "first_name": "...", "last_name": "...", "name": "...",
  "headline": "...", "location": "...",
  "current_company": "...", "current_title": "...",
  "positions": [...],                    // 完整结构化经历
  "experience_history": "...",           // 渲染好的字符串（兼容字段）
  "educations": [...], "skills": [...],

  "hits": [...],
  "hard_filter_result": "通过宽松硬筛",
  "scores_breakdown": [{"key":"...","score":90}, ...],
  "score": 87, "tier": 1,
  "scored_by": "rule" | "llm",
  "reasoning": "...",
  "matched_signals": [...], "missed_signals": [...],
  "highlight_for_outreach": "...",

  "connect_status": "待确认"             // Phase 4 维持，Phase 6 更新
}
```
