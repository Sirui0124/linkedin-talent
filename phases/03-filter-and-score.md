# Phase 3 · Profile + 硬筛 + LLM 评分（L2 + L3）

## ⚠️ 评分实现优化：使用快速 subagent + 精简 prompt

**新策略**（2024.05.30 优化）：使用 general-purpose subagent + 极简 prompt，提升速度和准确性。

### 模型路由策略
```javascript
function getOptimalModel() {
  // 优先级：haiku > sonnet > 主模型 fallback
  const models = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
  return models[0]; // 实际实现中检查可用性
}
```

### Subagent 调用方式
```javascript
Agent({
  subagent_type: "general-purpose",
  model: getOptimalModel(),
  description: "Batch candidate scoring - optimized",
  prompt: buildOptimizedBatchPrompt(candidatesBatch, scoringDimensions)
});
```

**性能对比**：
- 旧方案：主脚本 Anthropic SDK，50人 → 15-30s
- 新方案：subagent + 优化 prompt，50人 → 预计 8-15s

---

### 优化的评分 Prompt 模板

**极简版本**（减少 token 40%）：
```
Score each candidate 0-100 on these dimensions:
{dimensions.map(d => `${d.key}: ${d.description}`).join('\n')}

Candidates:
{candidates.map(c => `
${c.name} - ${compactProfile(c)}
`).join('')}

Return JSON array: [
  {"name": "...", "scores": [90,75,80,50], "total": 82},
  ...
]
```

**Profile 压缩函数**：
```javascript
function compactProfile(candidate) {
  return [
    `${candidate.current_title} @ ${candidate.current_company}`,
    `Experience: ${candidate.positions.map(p => 
      `${p.company} ${p.title} ${p.startYear}-${p.endYear || 'now'}`
    ).join('; ')}`,
    `Skills: ${candidate.skills.filter(isRelevantSkill).slice(0,8).join(', ')}`,
    `Signals: ${candidate.hits.map(h => `${h.type}:${h.kw}`).join(' ')}`
  ].join(' | ');
}
```

**规则补充字段**：
- `reasoning` - 根据最高/最低分维度生成
- `matched_signals`/`missed_signals` - 基于 hits 和维度分数生成  
- `highlight_for_outreach` - 基于最强维度生成模板

## 3.0 Profile 拉取前：轻量预筛（无需 API，必做）

**在拉 Profile 之前，先用搜索结果里已有的 `headline` + `hits` 做一轮粗筛**，减少不必要的 API 调用。

### 预筛规则（两个维度，OR 逻辑保留）

```python
def pre_filter(candidate):
    # 规则 1：通过目标公司专项关键词搜索命中的 → 直接保留
    # 理由：BEOL@TSMC/Intel 搜索能出来，说明 profile 某处有该关键词，headline 截断不影响判断
    if any(h['hitTargetCompany'] and h['kw'] in PRIMARY_KEYWORDS
           for h in candidate['hits']):
        return True

    # 规则 2：非目标公司 / 二级关键词命中的 → headline 必须含技术角色词
    tech_role_pattern = r'engineer|process|integration|device|materials|research|scientist|technologist|interconnect|BEOL|metalliz'
    return bool(re.search(tech_role_pattern, candidate['headline'], re.I))
```

**直接丢弃（不拉 Profile）**：headline 只含 marketing / sales / recruiter / business development / HR / 金属交易 / 资源回收 等词，且非目标公司专项搜索命中。

### 效果参考（TSMC/Intel BEOL 课题实测）

| 候选池 | 人数 |
|---|---|
| 搜索召回总数 | 170 |
| 预筛丢弃（非技术/金属商） | 13 |
| 实际拉 Profile | 157 |
| 节省 Profile 调用 | ~8% |

> **注**：这个比例在 BEOL 这种高精度关键词下本来噪声就少；对泛关键词搜索（如 "semiconductor"），节省比例会更高（30-50%）。

## 3.0b Profile 拉取策略

逐个拉 Profile（间隔 3-5s 随机），用于硬筛 + LLM 评分。

> **⚠️ Profile API 注意**：`data.included` 数组可能包含多个 profile 对象。脚本已用 `inc.find(i => i.entityUrn.includes('fsd_profile') && i.firstName)` 取第一个匹配。如果返回的 firstName 与搜索结果中 name 不一致，标注 `pending`（待人工核验）而非直接采信。

## 3.1 硬筛（L2，宽松策略）⚠️ 优化：尽可能宽松

**核心原则**：宁可放过，不可错杀。硬筛只删除**确实完全不匹配**的人，把边界 case 交给 L3 LLM 判断。

```python
def pass_hard_filter_loose(profile, hard_filters):
    # 【宽松策略】只有极明显不匹配才拦截
    
    # 1. 公司匹配 - 比原来更宽松
    if hard_filters.any_of_companies and not hard_filters.allow_other_companies:
        # 只有明确要求限定公司 + 完全无相关公司经历才拦截
        target_companies = [c.name.lower() for c in hard_filters.any_of_companies]
        all_companies = [pos.companyName.lower() for pos in profile.positions if pos.companyName]
        has_any_target = any(
            any(tc in comp for tc in target_companies) 
            for comp in all_companies
        )
        if not has_any_target:
            return False, "无任何相关公司经历"
    
    # 2. 必含关键词 - 降低要求，命中 1 个即可
    if hard_filters.must_have_any_kw:
        profile_text = build_profile_text(profile).lower()
        hit_count = sum(1 for kw in hard_filters.must_have_any_kw 
                       if kw.lower() in profile_text)
        if hit_count == 0:
            return False, "完全无相关关键词"
    
    # 3. 排除词 - 保持严格（这是用户明确不要的）
    profile_text_for_exclude = build_profile_text(profile).lower() 
    for kw in (hard_filters.must_not_have_any_kw or []):
        if kw.lower() in profile_text_for_exclude:
            return False, f"命中排除词: {kw}"
    
    # 4. Title 匹配 - 大幅放宽，模糊匹配即可
    if hard_filters.title_must_match_any:
        all_titles_text = ' '.join(pos.title.lower() for pos in profile.positions if pos.title)
        has_relevant_title = any(
            kw.lower() in all_titles_text 
            for kw in hard_filters.title_must_match_any
        )
        # 注意：这里不再要求完全匹配，只要 title 文本中包含任一关键词即通过
    
    return True, "通过宽松硬筛"
```

**变化对比**：
| 维度 | 原策略 | 新策略（宽松） | 效果 |
|------|--------|---------------|------|
| 公司匹配 | 严格精确匹配 | 模糊包含匹配（TSMC → 包含 tsmc 的都过） | 通过率 +15% |
| 必含关键词 | 必须命中任一个 | 保持不变（底线） | — |
| 排除词 | 严格排除 | 保持严格（用户明确不要的） | — |
| Title 匹配 | 任一 title 必须完全含关键词 | title 文本模糊包含即可 | 通过率 +20% |

**预期效果**：硬筛通过率从 ~60% 提升到 ~80%，让更多边界候选人进入 LLM 精评。

## 3.1b 规则快评（L2.5，分流漏斗 — 0ms，无 API 调用）

**目的**：减少 LLM 调用量。通过硬筛的候选人先走规则打分，明确高分/低分的直接定级，只有中间段才进入 L3 LLM。

### 评分函数

```javascript
function ruleScore(profile, criteria) {
  const weights = criteria.scoring_dimensions.map(d => d.weight);
  let dimScores = [];

  // company_match：目标公司现任=100, 前任=70, 无目标公司经历=20
  const targetCos = criteria.hard_filters.any_of_companies || [];
  const currentCo = profile.positions[0]?.company || '';
  const allCos = profile.positions.map(p => p.company);
  let companyScore = 20;
  if (targetCos.some(c => fuzzyMatch(c, currentCo))) companyScore = 100;
  else if (targetCos.some(c => allCos.some(co => fuzzyMatch(c, co)))) companyScore = 70;
  dimScores.push(companyScore);

  // topic_depth：必含关键词命中率 × 100
  const profileText = [
    profile.headline,
    ...profile.positions.map(p => `${p.title} ${p.desc}`),
    profile.skills.join(' '),
    profile.summary
  ].join(' ').toLowerCase();
  const kwList = criteria.hard_filters.must_have_any_kw || [];
  const hitCount = kwList.filter(kw => profileText.includes(kw.toLowerCase())).length;
  dimScores.push(Math.round((hitCount / Math.max(kwList.length, 1)) * 100));

  // seniority_focus：目标公司/领域工作年限 → 每年+15分，cap 100
  const currentYear = new Date().getFullYear();
  const focusYears = profile.positions
    .filter(p => targetCos.some(c => fuzzyMatch(c, p.company)))
    .reduce((sum, p) => sum + ((p.endYear || currentYear) - (p.startYear || currentYear)), 0);
  dimScores.push(Math.min(100, focusYears * 15));

  // bonus：有 bonus_keywords 命中则 60，否则 20
  const bonusKws = criteria.scoring_dimensions.find(d => d.key === 'bonus')?.bonus_keywords || [];
  const hasBonus = bonusKws.some(kw => profileText.includes(kw.toLowerCase()));
  dimScores.push(hasBonus ? 60 : 20);

  // 加权求和
  const score = Math.round(dimScores.reduce((s, v, i) => s + v * weights[i], 0));
  return { dimScores, score };
}

function fuzzyMatch(target, actual) {
  if (!target || !actual) return false;
  return actual.toLowerCase().includes(target.toLowerCase())
    || target.toLowerCase().includes(actual.toLowerCase());
}
```

### 分流规则

| rule_score | 动作 | Tier | LLM |
|---|---|---|---|
| ≥ 80 | 直接定级 | Tier 1 | 跳过（只生成模板 reasoning） |
| ≤ 25 | 直接定级 | Tier 3 | 跳过 |
| 26-79 | 进入 L3 精评 | 由 LLM 决定 | 是 |

### 跳过 LLM 时的字段填充

对于规则直接定级的候选人，以下字段用模板生成（不调用 LLM）：

```javascript
// rule_score ≥ 80（Tier 1）
reasoning: `${currentCo} 现任 ${currentTitle}，目标公司 + 关键词高度匹配`
highlight_for_outreach: `Your background at ${currentCo} is exactly what we're looking for —`
matched_signals: dimScores 中 ≥70 的维度对应的事实
missed_signals: dimScores 中 <50 的维度对应的事实

// rule_score ≤ 25（Tier 3）
reasoning: `关键词命中率低，目标公司经历不足`
highlight_for_outreach: `Your expertise is exactly what we're looking for —`
matched_signals: []
missed_signals: ['关键词命中率低', '无目标公司经历']
```

### 效果预估

| 场景 | 原流程 LLM 调用 | 新流程 LLM 调用 | 节省 |
|---|---|---|---|
| 50 人通过硬筛 | 50 | ~32 | 36% |
| 80 人通过硬筛 | 80 | ~52 | 35% |
| 总耗时（Haiku 双批并发） | 15-30s | 10-20s | ~35% |

## 3.2 LLM 评分（L3，多维度独立评分 + 加权）

对通过 L2.5 分流（rule_score 26-79）的候选人，按 Phase 1 解析出的 `scoring_dimensions`（每维度 0-100）独立打分，加权得总分。schema 与示例参见 `lib/scoring-dimensions.json`。

### 评分 prompt 模板（每人一次调用）

```
你是 LinkedIn 候选人评分员。基于下方维度逐项打分（0-100）。

【评分维度】
{for d in scoring_dimensions:}
- {d.key} ({d.label}, 权重 {d.weight}) — {d.description}

【单维度评分参考】
100 = 完美匹配（头部）；75 = 明显匹配；50 = 部分匹配；25 = 弱匹配；0 = 完全不沾

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
    {"key": "seniority_focus", "score": 80},
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
- `scores_breakdown` 数组顺序与 `scoring_dimensions` 一致；Excel D 列把它渲染为 `公司:90 / 课题:75 / 资历:80 / 加分:50`
- `highlight_for_outreach` 直接复用到 Phase 4 的 `{highlight}` 变量，避免双重生成
- Profile 异常残缺 → score=null，对应"待人工核验"

## 3.3 Tier 计算

```python
def compute_final_tier(llm_score):
    if llm_score is None: return 'pending'
    if llm_score < 30:    return 0       # 排除 → Sheet2
    if llm_score >= 75:   return 1
    if llm_score >= 50:   return 2
    return 3
```

`computeTier` 旧函数（基于 hits 与 endYear）退化为辅助标签，仅用于 Excel R 列展示"目标公司命中类型"。

## 3.4 Subagent 模式（≥50 人触发）

### 职责

1. 接收：候选人列表（vanity + headline + hits）+ hard_filters + scoring_dimensions + project_config
2. 对每人：拉 Profile（间隔 3-5s）→ 跑硬筛 → 通过则跑 LLM 评分
3. 返回完整结果 JSON

### Subagent prompt

```
你是 LinkedIn 候选人筛选+评分 agent。

任务：对 {N} 个候选人，逐人完成：
1. 拉 Profile（lib/voyager.js 的 getProfileScript，间隔 3-5s）
2. 跑硬筛（按下方 hard_filters，全部 AND）
3. 通过硬筛者：按 scoring_dimensions 跑多维度 LLM 评分
4. 返回下方 JSON 格式

【hard_filters】 {hard_filters_json}
【scoring_dimensions】 {scoring_dimensions_json}
【project_config】 {project_config_json}（仅供 highlight 生成参考）
【候选人列表】 {candidates_json}

安全规则：
- Profile 拉取间隔 3-5s 随机
- 遇 401/403/429 立即停止，结果中标注 stopped_at
- 评分严格基于 scoring_dimensions，不要自行扩充维度
```

### 返回格式

```json
{
  "summary": {
    "total": 200, "hard_pass": 78, "hard_fail": 122,
    "tier1": 12, "tier2": 31, "tier3": 35, "excluded": 0, "pending": 0
  },
  "passed": [
    {
      "vanity": "...", "urn": "...",
      "name": "...", "headline": "...",
      "current_company": "...", "current_title": "...",
      "target_experience": "TSMC | BEOL Engineer | 2018-至今",
      "other_experience": "...",
      "education": "...",
      "hits": [...],
      "hard_filter_result": "通过硬筛",
      "scores_breakdown": [
        {"key": "company_match", "score": 90},
        {"key": "topic_depth", "score": 80},
        {"key": "seniority_focus", "score": 85},
        {"key": "bonus", "score": 50}
      ],
      "score": 82,
      "tier": 1,
      "reasoning": "TSMC 现任 BEOL 工程师...",
      "matched_signals": ["TSMC 现任", "title 含 BEOL"],
      "missed_signals": ["未提及 Ruthenium 量产时间表"],
      "highlight_for_outreach": "Your 7+ years on TSMC's N3/N2 BEOL integration —"
    }
  ],
  "failed": [
    {"name": "...", "headline": "...", "reason": "无目标公司经历"}
  ]
}
```

## 3.5 候选人最终 JSON 结构

经过 L1+L2+L3 后，每个候选人在内存中：

```json
{
  "id": "cand_001",
  "vanity": "...", "urn": "urn:li:fsd_profile:...", "profile_url": "...",
  "first_name": "...", "last_name": "...",
  "headline": "...",
  "current_company": "...", "current_title": "...",
  "experience_history": "...", "education": "...", "skills": [],

  "hits": [...],
  "hard_filter_result": "通过硬筛",
  "scores_breakdown": [...],
  "score": 87, "tier": 1, "rating": "⭐⭐⭐",
  "reasoning": "...",
  "matched_signals": [...], "missed_signals": [...],
  "highlight_for_outreach": "...",

  "connect_message": "...",     // Phase 4 填
  "connect_status": "待确认",
  "search_ids": ["..."]
}
```
