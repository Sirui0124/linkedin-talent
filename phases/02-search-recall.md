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
- `hard_filters.target_employment` / `hard_filters.employment_recency`

优先级：

1. 有 `company_topic_matrix` 时，按每个公司自己的 queries 搜。
2. 没有 matrix 但有 `target_companies` 时，按 `primary keyword × target_companies × current/past company` 搜。
3. 没有公司池时，按纯关键词搜。

若 criteria 明确写了 `target_employment`，公司过滤策略随之收窄：

- `mode=current_only` / `require_current=true` / 只接受 `current` → 只跑 `currentCompany`。
- `mode=departed_only` / `require_departed=true` / 只接受前任或离职 → 只跑 `pastCompany`。
- `mode=current_or_recent_departure` 或未声明 → 同时跑 `currentCompany` 和 `pastCompany`，再交给 Phase 3 判断离职年份。

搜索词应尽量长得像 `company + role + ecosystem position (+ topic)`，而不是 `company + generic product`。如果 primary 已经退化成单纯锚点公司名、泛行业词或泛产品大类，说明策略校对还不够收敛。

公开预研 query 不应直接进入本阶段。网页预研可以用长 query 查新闻、项目名、地名、审批和合作方；LinkedIn 召回要改写成候选人资料里可能出现的短词，优先是公司/机构名加职能、岗位、设施类型或生态位置。看到 `construction progress in ...`、`former plant redevelopment`、`approval timeline` 这类网页式 query 时，应回到 Phase 1 重写。

公司 ID 能从 `lib/config.js` 找到时使用 LinkedIn `currentCompany` / `pastCompany` filter；dry-run 显示为 `keyword · currentCompany/pastCompany · company`，这等价于 `keyword + company filter`，不需要把公司名重复拼进 keyword。找不到 company ID 时才退化为完整 `company name + keyword` 纯关键词搜索，并在 dry-run 里标记 `company_id_missing_keyword_fallback`。

fallback 拼接必须保守：只有 keyword 已包含完整公司名、明确公司名 token，或明确 acronym 时才认为"已带公司"。公司名里的行业/实体泛词不能算命中，例如 `Power`、`Systems`、`Modules`、`Semiconductor`、`Devices`、`Technologies`。否则 `Monolithic Power Systems + AI accelerator power` 会被错误缩成裸 `AI accelerator power`，导致搜索过宽。

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
