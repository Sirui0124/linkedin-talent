# Phase 4 · 导出 Excel + 生成话术

## 4.1 单批次 Excel

按 `lib/excel-schema.json` 渲染，落地路径 `~/Downloads/linkedin_search_{batch_id}.xlsx`。

**关键点**：
- 包含两个 Sheet：`筛选通过`（按 score 降序）+ `未通过`
- D 列「维度评分」把 `scores_breakdown` 渲染成 `公司:90 / 课题:75 / 资历:80 / 加分:50`
- 经历格式：`公司名 | 职位 | 起始年-结束年`，多段换行；**禁止**额外加工
- 行配色按 tier：tier1 绿 / tier2 蓝 / tier3 无；表头 `4472C4`；冻结首行
- 长文本列启用 wrap_text（参见 schema 的 `wrap_text_columns`）

详细列表参见 `lib/excel-schema.json`，不在这里重复。

**筛选宽松原则**：宁可多放 ⭐ tier3，不可误排。Profile 未获取的 pastCompany 命中默认 tier2。

## 4.2 生成 Connect 话术

从 `lib/connect-templates.json` + Phase 1.5 确认的 `project_config` 渲染，写入 Excel `Q` 列。

### 模板选择
- 模板：`templates[chosen_type].connect_message`（type1_friendly / type2_direct / type3_detailed_inmail）
- 长度：type1/type2 严格 ≤ 280 字符（LinkedIn 上限留 20 字符余量）；type3 无限制
- 变量：`{firstName}`, `{senderName}`, `{senderTitle}`, `{company}`, `{topic_obfuscated}`, `{topic_label}`, `{rate_range}`, `{expertise}`, `{highlight}`

### `{highlight}` / `{expertise}` 直接复用 LLM 评分输出

不再让 Claude 在生成话术时重新挑亮点 —— 直接读 Phase 3.2 已经生成的 `highlight_for_outreach`：

- type1_friendly / type2_direct → `{highlight}` = `highlight_for_outreach`
- type3_detailed_inmail → `{highlight}` 同上；`{expertise}` 优先用 `project_config.expertise` 默认值

避免双重生成漂移。

### 生成规则

1. 每个筛选通过的候选人都必须生成 Q 列内容
2. Profile 异常（pending）→ 基于 headline 兜底生成，状态列标"待人工核验"
3. 语言遵循 `language_rules`：默认英文；候选人中文姓名/headline 则用中文
4. 严格检查字符数，超出则压缩 highlight 部分
