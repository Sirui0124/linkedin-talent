# Phase 2 · 搜索 / 召回（L1）

**目标**：用最少的 API 调用把候选池缩到 ~150-250 人。命中率优先于覆盖率，覆盖由 L2 硬筛 + L3 评分弥补。

**执行**：Claude 按下方调用矩阵编排，逐次调用 `lib/voyager.js` 的 `searchCandidatesScript()`，结果累计到 `~/.linkedin-talent/exports/raw_<batch_id>.json`。

**实施细节** — CSRF 转义、companyFilter 格式、错误码处理在 `lib/voyager.js` 函数注释里；间隔与停止阈值在 `lib/safety.json`。本文件只描述**调用编排逻辑**与**播报话术**。

## 调用矩阵

```
primary keyword × {currentCompany, pastCompany} × target_companies
  + secondary keyword（无公司过滤，独立兜底搜）
  + 必要时 fallback keyword（前两轮总人数 < 50 时启用，阈值见 safety.json）
```

伪代码：
```python
all_candidates = {}  # key: vanity

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

# 第二轮：secondary × 无公司过滤
for kw in search_keywords.secondary:
    for page in 0..N:
        results = searchCandidatesScript(start=page*20, kw, companyFilter='')
        sleep(3-5s)
        for r in results:
            merge_or_add(all_candidates, r,
                         hit={kw, strategy: 'keyword', hitTargetCompany: false})

# 第三轮（兜底）：仅当 len(all_candidates) < safety.fallback_keyword_trigger
if len(all_candidates) < 50 and search_keywords.fallback:
    for kw in search_keywords.fallback:
        ... # 同 secondary 处理

return all_candidates
```

## 调用规模示例（TSMC/Ruthenium）

| 轮次 | 调用 | 次数 | 召回上限 |
|------|------|------|---------|
| primary BEOL × TSMC current/past + Intel current/past | 4 公司×策略 × 5 页 | 20 | ~400 |
| secondary Ruthenium 无公司过滤 | 3 页 | 3 | ~60 |
| **小计** | **23 次调用** | **去重后 150-250** |
| fallback（如需） | 各 3 页 | +6 | ~120 |

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
