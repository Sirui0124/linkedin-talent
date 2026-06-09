# Phase 2 · 搜索召回脚本契约

实际搜索流程由 `scripts/phase2-search-recall.mjs` 实现，本文件只保留执行边界，避免搜索编排散在文档里。

## 入口

```bash
node scripts/phase2-search-recall.mjs --batch-id <id>
```

高级用法：

```bash
node scripts/phase2-search-recall.mjs \
  --criteria data/criteria/<id>.json \
  --output data/exports/raw_<id>.json
```

检查搜索计划但不调用 LinkedIn API：

```bash
node scripts/phase2-search-recall.mjs --batch-id <id> --dry-run
```

## 输入

读取 Phase 1 写入的 `data/criteria/<batchId>.json`，兼容字段：

- `delivery_mode.mode` / `delivery_mode.search_pool`
- `search_recall.target_min` / `target_max` / `target_per_search`
- `search_keywords.primary` / `secondary` / `fallback`
- `search_keywords.company_topic_matrix`
- `target_companies`

优先级：

1. 有 `company_topic_matrix` 时，按每个公司自己的 queries 搜。
2. 没有 matrix 但有 `target_companies` 时，按 `primary keyword × target_companies × current/past company` 搜。
3. 没有公司池时，按纯关键词搜。

搜索词应尽量长得像 `company + role + ecosystem position (+ topic)`，而不是 `company + generic product`。如果 primary 已经退化成单纯锚点公司名、泛行业词或泛产品大类，说明策略校对还不够收敛。

公司 ID 能从 `lib/config.js` 找到时使用 LinkedIn `currentCompany` / `pastCompany` filter；找不到时退化为 `company name + keyword` 纯关键词搜索，并在 dry-run 里标记 `company_id_missing_keyword_fallback`。

## 输出

写入：

```text
data/exports/raw_<batchId>.json
```

结构：

```json
{
  "summary": {
    "batch_id": "search_YYYYMMDD_HHMM",
    "api_calls": 12,
    "total": 138,
    "stop_reason": null
  },
  "candidates": [
    {
      "name": "...",
      "headline": "...",
      "location": "...",
      "profile_url": "https://www.linkedin.com/in/...",
      "vanity": "...",
      "urn": "...",
      "connectionDegree": "...",
      "hits": [
        {"kw": "Accenture Salesforce", "strategy": "currentCompany", "company": "Accenture", "hitTargetCompany": true, "stage": "primary"}
      ]
    }
  ]
}
```

Phase 3 可直接消费这个 JSON。

## 停止规则

- 达到 `target_min` 后，不再进入 secondary / fallback。
- 达到 `target_max` 后停止。
- 401 / 403 / 429 立即停止整批，并把原因写入 `summary.stop_reason`。
- 每页搜索间隔取 `lib/config.js` 的 `DEFAULT_SEARCH_CONFIG.pageDelay`。

## 播报

按 `templates/broadcast.md` 的搜索阶段风格播报。不要每页向用户长篇汇报；脚本 stdout 已记录每组调用和去重人数。
