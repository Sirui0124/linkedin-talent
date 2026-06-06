# Phase 2 · 搜索 / 召回（L1）

**目标**：按 Phase 1 的 `delivery_mode` 决定召回规模。校准模式搜 ~100-200 人并返回 10 个高信号 profile；一步到位模式搜 ~300-500+ 人并筛出 50-100 个专家，供后续 connect 70-80 人以争取 2-3 个有效访谈。

**执行**：Claude 按下方调用矩阵编排，逐次调用 `lib/voyager.js` 的 `searchCandidatesScript()`，结果累计到 `data/exports/raw_<batch_id>.json`。

**实施细节** — CSRF 转义、companyFilter 格式、错误码处理在 `lib/voyager.js` 函数注释里；间隔与停止阈值在 `lib/safety.json`。本文件只描述**调用编排逻辑**与**播报话术**。

## 调用矩阵

若 Phase 1 生成了 `ecosystem_company_discovery.required=true`，L1 primary 必须优先使用发现出的生态公司/合作方/承包方作为公司或关键词锚点。不要把 `channel partner`、`reseller`、`construction progress` 这类关系词直接当 primary 人物搜索词；它们只能和具体公司名一起使用，或作为 fallback。

若 Phase 1 的 `intent.view=channel_partners`，`target_companies` 应优先放外部渠道/合作伙伴公司，而不是锚点原厂公司。锚点公司名（例如 Snowflake）应进入搜索关键词或 hard filter，用来确认候选人与该生态相关；原厂员工搜索只作为补充池。若 `intent.view=both`，必须把渠道公司池和原厂公司池分两轮跑，并在命中记录里区分来源。

若 Phase 1 的 `personas` 写了 `quota`，先按 persona 配额逐组召回，再看全局 `target_min/target_max`。不要因为第一个 persona 的 broad query 已经搜满 100 人，就跳过其他能回答关键问题的人群。

若 `delivery_mode.mode=calibration`，达到 100-200 去重候选池后停止，并优先输出 10 个代表性候选给用户校准准确性。若 `delivery_mode.mode=full_run`，不要在 100-200 停止；继续扩到 300-500+ 搜索池，目标是筛出 50-100 个可 connect 专家。

```
primary keyword × {currentCompany, pastCompany} × target_companies
  → 达到 search_recall.target_min 后停止
  → 不足再跑 secondary keyword（无公司过滤，独立兜底搜）
  → 仍不足再跑 fallback keyword
```

伪代码：
```python
all_candidates = {}  # key: vanity
target_min = criteria.search_recall.target_min or (300 if delivery_mode.mode == 'full_run' else 100)
target_max = criteria.search_recall.target_max or (500 if delivery_mode.mode == 'full_run' else 200)

def reached_target():
    return len(all_candidates) >= target_min

# 第一轮：primary × 所有目标公司 × {current, past}
for kw in search_keywords.primary:
    for company in target_companies:
        company_id = lookup_company_id(company.name)   # 见下"公司 ID 查找"
        for strategy in [currentCompany, pastCompany]:
            for page in 0..ceil(target_per_search / 20):
                companyFilter = buildCompanyFilter(strategy, [company_id])
                results = searchCandidatesScript(start=page*20, kw, companyFilter)
                sleep(3-5s)
                for r in results:
                    merge_or_add(all_candidates, r,
                                 hit={kw, strategy, company, hitTargetCompany: true})
            if reached_target():
                break
        if reached_target():
            break
    if reached_target():
        break

# 第二轮：仅当 primary 未达标，secondary × 无公司过滤
if not reached_target():
    for kw in search_keywords.secondary:
        for page in 0..N:
            results = searchCandidatesScript(start=page*20, kw, companyFilter='')
            sleep(3-5s)
            for r in results:
                merge_or_add(all_candidates, r,
                             hit={kw, strategy: 'keyword', hitTargetCompany: false})
        if reached_target():
            break

# 第三轮（兜底）：仅当 primary + secondary 仍未达标
if not reached_target() and search_keywords.fallback:
    for kw in search_keywords.fallback:
        ... # 同 secondary 处理
        if reached_target():
            break

if len(all_candidates) > target_max:
    all_candidates = keep_best_search_hits(all_candidates, target_max)

return all_candidates
```

## 调用规模示例（TSMC/Ruthenium）

| 轮次 | 调用 | 次数 | 召回上限 |
|------|------|------|---------|
| primary BEOL × TSMC current/past + Intel current/past | 4 公司×策略 × 5 页 | 20 | ~400 |
| secondary Ruthenium 无公司过滤 | primary 未达标才跑 | 3 | ~60 |
| **小计** | **阶段间达标即停** | 20-23 | **去重后 100-200** |
| fallback（如需） | primary + secondary 未达标才跑 | +6 | ~120 |

## 搜索结果可用字段与轻量预筛

Voyager 搜索卡片阶段稳定可拿到的是 `name / headline / location / profile_url / vanity / urn / connectionDegree`。其中 `headline` 通常像 "Title at Company"，可用于轻量判断职位类型，但不是结构化 current title/company；完整职位、公司、起止时间必须等 Profile API。

因此搜索后、Profile 前只允许做**轻量预筛**：
- 如果 `headline` 明确命中 `prefilter.title_match_any` 或 `hard_filters.title_must_match_any`，保留；
- 如果 `headline` 为空，或是目标公司 + 搜索关键词命中，保留给完整 Profile 判断；
- 如果 `headline` 明确不属于目标职位类型（例如需求是 engineer，但 headline 是 product manager），可先丢弃以减少 Profile 调用；
- 不要使用全局技术岗/商业岗噪声词。channel / sales / procurement / BD / marketing 等是否噪声，必须由当批 criteria 决定。

## 公司 ID 查找

`lib/config.js` 的 `COMPANY_ID_MAP` 已收录主流公司（Alibaba 1538 / Tencent 5765 / ByteDance 15525013 / Microsoft 1035 / Google 1441 / Intel 1053 / TSMC 8869 / NVIDIA 3608 / ASML 1887 等）。

未在映射的公司 → 用 `lib/voyager.js` 的 `findCompanyIdScript()` 通过 typeahead 查找；typeahead 偶发 500 → 让用户在 LinkedIn 网页搜公司，从 URL 提取 ID 后回填 `COMPANY_ID_MAP`。

## 跨搜索去重 + 命中记录

候选人按 vanity 去重；同一 vanity 多次命中时合并 `hits` 数组：

```json
{
  "vanity": "...",
  "hits": [
    {"kw": "BEOL", "strategy": "currentCompany", "company": "TSMC", "hitTargetCompany": true},
    {"kw": "Ruthenium", "strategy": "keyword", "hitTargetCompany": false}
  ]
}
```

`hits` 用于 Phase 3 预筛初步标记 + 后续 Excel "搜索命中" 列；不直接决定 tier（tier 由 LLM 评分决定）。

## 播报

按 `templates/broadcast.md` 的"搜索阶段"段；每完成一轮 primary 报一次进度，不要每页报。
