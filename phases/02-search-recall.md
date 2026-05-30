# Phase 2 · 搜索 / 召回（L1）

**目标**：用最少的 API 调用把候选池缩到 ~200 人。命中率优先于覆盖率，覆盖由 L2 硬筛 + L3 评分弥补。

播报风格见 `templates/broadcast.md` 的"搜索阶段"段。

## 调用矩阵

```
primary keyword × {currentCompany, pastCompany} × target_companies
  + secondary keyword（无公司过滤，独立兜底搜）
  + 必要时 fallback keyword（前两轮总人数 < 50 时启用）
```

伪代码：
```python
all_candidates = {}  # key: vanity

# 第一轮：primary × 所有目标公司 × {current, past}
for kw in search_keywords.primary:
    for company in target_companies:
        company_id = lookup_company_id(company.name)
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

# 第三轮（兜底）：仅当 len(all_candidates) < 50
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

引用 `lib/config.js` 中的 `COMPANY_ID_MAP`。常用：
- Alibaba 1538 · Tencent 5765 · ByteDance 15525013 · NetEase 5116
- Microsoft 1035 · Google 1441 · NVIDIA 3608 · Intel 1053 · AMD 5283
- Samsung 1753 · ASML 1887
- ⚠️ TSMC/台积电：首次使用前必须验证（config.js 中已置 null）

未在映射的公司 → `lib/voyager.js` 的 `findCompanyIdScript(companyName)` 通过浏览器 typeahead 查找；typeahead 偶发 500 → LinkedIn 网页搜索后从 URL 提取 company ID。

## 调用细节

`lib/voyager.js` 的 `searchCandidatesScript(start, keywords, companyFilter)` 生成搜索脚本，通过 `opencli browser linkedin eval "<script>"` 执行。

> **⚠️ CSRF 正则关键**：`opencli browser eval` 中双引号需用 `\\\"` 转义，正则模式为 `/JSESSIONID=\\\"?([^;\\\"]+)/`。

`companyFilter` 参数：
- 当前公司：`(key:currentCompany,value:List(5765)),`
- 前公司：`(key:pastCompany,value:List(1538)),`
- 纯关键词：空字符串 `''`

每页间隔 3-5s 随机；results 为空即跳过该组；遇 401/403/429 立即停止整个 Phase 2（参见 `lib/safety.json`）。

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

`hits` 用于 Phase 3 硬筛初步标记 + 后续输出"命中信息"列；不直接决定 tier（tier 由 LLM 评分决定）。
