# 解析镜像示例 — Snowflake 销售渠道课题

示例只用于理解格式，不要逐字复制。Phase 1 面向用户要短，详细搜索策略写入本地 `data/criteria/<batchId>.json`。

## 用户输入

> 找 3 位 Snowflake 的销售渠道，了解 Q1 consumption 增长、Q2 增长判断、Cortex Code 客户反馈、Snowflake Intelligence consumption 占比、Snowpark 与 Iceberg consumption 占比。

## 渲染输出

```
我先按下面这个方向拆。请核对，任何一条不对都告诉我：

【课题与问题】（仅内部）
  Snowflake Q1/Q2 consumption and product adoption checks through sales/channel experts
  要回答：
  · Q1 consumption 增长情况
  · Q2 增长怎么看
  · Cortex Code / Snowflake Intelligence / Snowpark / Iceberg 的客户反馈与 consumption 贡献

【我的理解】
  锚点公司：Snowflake；视角：外部渠道/合作伙伴
  · 优先找 Snowflake partner / SI / marketplace / implementation 公司里接触客户和 pipeline 的人。
  · Snowflake 原厂 GTM / Partner SE 只作为补充池。
  · 3 位专家可以分工覆盖问题，不要求每个人覆盖全部产品。

【交付模式】
  先做 calibration：搜 100-200 人，给你 10 profiles 校准；本轮不发 Connect。

【目标人群】
  我会依次找这几类专家：
  A. 外部渠道 / SI / consulting partner
     能回答：Q1/Q2 consumption、客户预算、pipeline、竞争替换
     搜索词：<partner_company> Snowflake, <partner_company> data cloud practice
     筛选标准：外部 partner 公司经历 + Snowflake GTM / 联盟 / 交付证据
  B. Cloud marketplace / alliance 专家
     能回答：marketplace 动销、云生态合作、客户采购路径
     搜索词：AWS Snowflake marketplace, Azure Snowflake, Google Cloud Snowflake
     筛选标准：云市场、ISV partnership、data platform partner 经验
  C. Snowflake 原厂补充画像（仅补充）
     能回答：官方 GTM、产品采用和 partner motion
     搜索词：Snowflake partner sales engineer, Snowflake GTM
     筛选标准：原厂 partner / GTM / customer engineering 经验

【Partner / 生态公司】
  我会先做一轮公司预研，找出真实 partner / SI / marketplace / implementation 公司，再按这些公司搜人；不会直接把 Snowflake 当作主要目标公司。
  · SI / consulting / cloud partners：待查；来源：partner locator / marketplace / awards / case studies

【策略文件】
  详细搜索策略我会存到：data/criteria/search_YYYYMMDD_HHMM_Snowflake.json
  这是本地 user data，不会同步到 GitHub；Phase 2/3 会按这份 JSON 校验和执行。

如果这些判断没问题，回复"确认"，进入 Phase 1.5。
```
