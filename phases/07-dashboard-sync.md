# Phase 7 · Master Dashboard 同步脚本契约

实际同步由 `scripts/phase7-sync-dashboard.mjs` 实现。本文件只说明输入、输出和兼容边界。

## 入口

```bash
node scripts/phase7-sync-dashboard.mjs --batch-id <id>
```

高级用法：

```bash
node scripts/phase7-sync-dashboard.mjs \
  --phase3 data/exports/phase3_<id>.json \
  --criteria data/criteria/<id>.json \
  --excel data/batches/linkedin_<id>.xlsx \
  --dashboard data/dashboard.xlsx
```

## 输入

- `phase3_<batchId>.json`：候选人评分结果，必需。
- `criteria/<batchId>.json`：课题、目标公司、关键词等批次元数据，可选。
- `linkedin_<batchId>.xlsx`：当批 Excel，可选；如果存在，脚本会读取「候选人」sheet 里的 `Connect状态`，以便同步 Phase 6 后的发送状态。

## 输出

写入或更新：

```text
data/dashboard.xlsx
```

包含两张 sheet：

- `候选人库`：按 `LinkedIn URL` 跨批次去重。
- `批次索引`：按 `batch_id` 记录每次搜索的课题、公司、关键词、数量和当批 Excel 路径。

## 合并规则

- 候选人去重 key：`LinkedIn URL`；phase3 没有 URL 时用 `vanity` 生成。
- `tier`：取更高推荐度，也就是数字更小的 tier。
- `首次出现批次`：已存在则保留。
- `最近出现批次`：每次更新。
- `出现次数`：每次命中 +1。
- `命中信息`、`备注`：去重合并。
- `Connect 状态`：只有本批为 `已发送` / `CANT_RESEND` / `失败` / `已接受` / `已 follow-up` 时覆盖；否则保留历史状态。
- `邀请发出时间`：首次 `已发送` 时写入，已有值不覆盖。

## 更新兼容边界

`data/dashboard.xlsx` 是用户本地数据，skill 自动更新不得覆盖。脚本只做兼容式 upsert：如果文件不存在，首次创建；如果已存在，读取旧数据后合并写回。

固定 review 看板 `templates/review-dashboard.html` 可以随代码更新；历史批次 Excel、`data/decisions/` 和 `data/dashboard.xlsx` 保持原位。
