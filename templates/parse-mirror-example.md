# 解析镜像示例 — Snowflake 销售渠道课题

示例只用于理解格式，不要逐字复制。

## 用户输入

> 找 3 位 Snowflake 的销售渠道，了解 Q1 consumption 增长、Q2 增长判断、Cortex Code 客户反馈、Snowflake Intelligence consumption 占比、Snowpark 与 Iceberg consumption 占比。

## 渲染输出

```
我从你的输入做了如下拆解。请核对，任何一条不对都告诉我：

【真实课题】（仅内部）
  Snowflake Q1/Q2 consumption and product adoption checks through sales/channel experts

【核心假设】
  锚点公司：Snowflake
  视角：channel_partners
  · "Snowflake 的销售渠道"默认指 Snowflake 外部渠道/合作伙伴视角。
  · Snowflake 原厂 GTM/Partner SE 可作为补充，但不默认排第一。
  · 3 位专家可以分工覆盖问题，不要求每个人都覆盖全部产品。

【要回答的问题】
  · q1. Q1 consumption 增长情况（必须覆盖）
  · q2. Q2 增长怎么看（必须覆盖）
  · q3. Cortex Code 客户反馈和 consumption（可加分/复核）
  · q4. Snowflake Intelligence consumption 占比（可加分/复核）
  · q5. Snowpark 与 Iceberg consumption 占比（可加分/复核）

【交付模式】
  模式：calibration
  搜索池：100-200
  输出目标：10 profiles
  Connect 目标：none

【目标人群】
  · Snowflake 外部渠道/合作伙伴 — priority 1，目标召回 60-100
    能回答：q1, q2, q3
    弱项：原厂正式口径、精确产品占比
    搜索入口：Snowflake alliance, Snowflake partner sales, Snowflake practice
    筛选证据：外部公司经历 + Snowflake GTM/联盟/解决方案/交付证据
  · Snowflake 原厂 GTM/Partner SE/AE — priority 2，目标召回 20-40
    能回答：q2, q3, q4, q5
    弱项：渠道抽样数字可能偏官方
    搜索入口：Snowflake Partner Sales Engineer, Snowflake Cortex GTM, Snowflake Snowpark
    筛选证据：Snowflake 原厂销售、伙伴工程、客户工程、产品 GTM 经历

【生态公司发现】
  是否需要：是
  · SI/consulting/cloud partners：Accenture, Deloitte, Slalom, AWS, Microsoft, Capgemini（待校验）
    来源/待查方向：partner locator / marketplace / awards / case studies

【搜索配置】
  primary：Snowflake alliance, Snowflake partner sales, Snowflake practice
  secondary：Cortex, Cortex Code, Snowpark, Iceberg
  fallback：AI Data Cloud, Snowflake marketplace
  目标公司：Accenture, Deloitte, Slalom, AWS, Microsoft, Capgemini, Snowflake

【硬筛规则】
  · 公司/生态：上述渠道公司或 Snowflake 原厂补充
  · Title：Partner / Alliance / Sales / Solution / Architect / GTM / Practice
  · 主题组：
    - Snowflake 相关（必需）：Snowflake / AI Data Cloud
    - Consumption/GTM（必需）：consumption / usage / marketplace / GTM / pipeline / sales
    - 产品覆盖（加分/复核）：Cortex / Cortex Code / Snowflake Intelligence / Snowpark / Iceberg
  · 排除词：无
  · 时效：现任或近 3-6 个月仍接触 Snowflake 客户/渠道优先

【评分维度】
  · 渠道视角 (权重 0.30) — 是否在外部渠道/合作伙伴侧接触 Snowflake 销售、联盟、交付或 marketplace
  · 问题覆盖 (权重 0.35) — 能覆盖 consumption、Q2 增长、Cortex/Snowflake Intelligence/Snowpark/Iceberg 中的多少项
  · 当前性 (权重 0.20) — 是否现任或近期仍接触 Snowflake 客户/渠道
  · 资历 (权重 0.15) — 是否足够接近客户决策、pipeline 或产品采用反馈

【预计调用规模】
  L1 搜索：校准模式先搜 100-200 人；若准确性确认，再扩到 300-500+ 人
  Profile + 筛选：先返回 10 人校准；full_run 目标筛出 50-100 个可 connect 专家
  Connect：full_run 后通常 connect 70-80 人，争取 2-3 个愿意接的人
  耗时：校准约 10-20 分钟；full_run 视搜索规模继续延长

如果这些判断没问题，回复"确认"，进入 Phase 1.5。
```
