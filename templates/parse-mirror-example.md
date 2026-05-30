# 解析镜像示例 — TSMC/Ruthenium 课题

下方是一份完整的渲染示例。对照 `parse-mirror.md` 骨架理解每段如何填空。**不要逐字复制示例文本** — Claude 必须根据用户实际输入重新生成各字段，但格式应与示例一致。

## 用户输入（风格 C · 自然语言）

> Project: could you try to find a TSMC engineer who works on the 2nm process and can speak to the adoption of Ruthenium in that process and how much Ruthenium the industry will use in the future? Intel engineer is ok too.
> A. Company: 1. TSMC（优先）2. Intel（次优）
> B. Keyword search: 2nm / advanced node / process integration / BEOL / interconnect / metallization / Ruthenium / Cu replacement
> C. Target roles: Process Integration Engineer / BEOL/Interconnect Engineer / Advanced Node/Device Engineer / Metallization/Materials Engineer
> D. 筛选逻辑:
>   1) TSMC/Intel 现任 + 近6个月内离职的人优先
>   2) 6个月以上离职的前员工作为补充
>   3) 其他公司但有很强相关背景（2nm/BEOL/interconnect/materials）的工程师也可考虑

## 渲染输出

```
我从你的输入做了如下拆解（搜索 → 硬筛 → 评分三层）。请核对，任何一条不对都告诉我：

【L0 真实课题】（仅内部）
  Ruthenium adoption in TSMC 2nm process, projecting industry usage

【L1 搜索关键词】（少而精，决定召回池）
  primary（必跑）：    BEOL
  secondary（必跑）：  Ruthenium
  fallback（不足时）： interconnect, metallization
  ↳ 不进搜索的词："2nm" / "advanced node" / "process integration" / "Cu replacement"
    原因：泛行业/节点名命中率过高，会稀释结果。已下沉到硬筛 must_have。

【L1 目标公司】
  TSMC (priority 1, ⚠️ ID 首次校验)
  Intel (priority 2)
  允许其他公司：是（命中 secondary keyword 后由硬筛把关）

【L2 硬筛规则】（全部 AND，确定性 yes/no）
  · 公司命中：TSMC / Intel 之一  → 标 hit_target_company=true
              其他公司 → 视为 tier3 候选，靠 must_have 把关
  · Profile 必含至少一个：
    BEOL / interconnect / metallization / Ruthenium / advanced node / 2nm / process integration
  · Title 必模糊匹配至少一个：
    Process Integration / BEOL / Interconnect / Device / Materials / Metallization / Advanced Node
  · Profile 不能含：marketing / sales / HR
  · 近期离职窗口：6 个月（决定 tier1 vs tier2）

【L3 LLM 评分维度】（每维度 0-100，加权得总分）
  · 公司匹配 (权重 0.30) — 是否在 TSMC/Intel 现任或近期前任，且参与 BEOL/互连相关团队
  · 课题深度 (权重 0.30) — 是否能就 Ruthenium 替代铜的具体技术（配方/良率/量产/用量）发言
  · 资历与聚焦度 (权重 0.25) — 是否 ≥5 年经验，且至少 2 年集中在 2nm/先进节点 BEOL 工序
  · 加分项 (权重 0.15) — imec/AMAT/Lam/TEL 经历、Ruthenium/Co replacement 论文、staff 以上 title

【Tier 分档】
  Tier1 ⭐⭐⭐ = 通过硬筛 + 总分 ≥75
  Tier2 ⭐⭐  = 通过硬筛 + 总分 50-74
  Tier3 ⭐   = 通过硬筛 + 总分 30-49
  排除      = 总分 <30 → Sheet 2

【预计调用规模】
  L1 搜索：5 次基础（primary BEOL × {TSMC current/past, Intel current/past} + secondary Ruthenium）
         + 必要时 fallback 2 次
  L2 硬筛：纯字符串规则，~200 人 instant
  L3 LLM 评分：通过硬筛 ~80 人 × 4 维度
  耗时：1-2 分钟搜索 + 4-8 分钟拉 Profile + 1-2 分钟评分 ≈ 7-12 分钟

如果有任何字段需要调整（特别是搜索关键词的取舍 / 评分维度的权重），告诉我；否则回复"确认"，进入 Phase 1.5。
```
