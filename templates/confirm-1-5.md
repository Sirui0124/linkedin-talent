# Phase 1.5 话术与课题确认消息

读取 `lib/connect-templates.json`，按下方骨架渲染。**用单条消息发出，等用户确认才进 Phase 2**。

## 自动生成 `topic_obfuscated`

从 `topic_specific` 提炼一个泛行业说法（不暴露客户/项目）。

| 真实课题 | 模糊话题建议 |
|---|---|
| Ruthenium adoption in TSMC 2nm process | advanced semiconductor process and technology development |
| Tencent 游戏出海策略 | global gaming market and overseas strategy |
| Anthropic LLM training infra | large model training infrastructure and scaling |

**关键原则：宁可粗一点，不要细一点。**
- ❌ 过细："advanced node BEOL metallization and next-gen interconnect materials"（暴露 BEOL/互连这个具体技术方向）
- ✓ 合适："advanced semiconductor process and technology development"（行业大方向）
- 提炼方法：保留课题所在的**一级行业领域**（半导体/游戏/LLM 基础设施），去掉具体子方向、技术名、节点名、材料名、公司名。

太具体会暴露客户/项目方向；太模糊则没诚意。让用户调整。

## 渲染骨架

```
寻访条件已确认 ✓

【背景】
{topic_one_liner — 一句话概括项目，含真实课题关键词，仅内部参考}
sender：{sender_name}（{sender_title} @ Funda.ai · Singapore-based research + expert network platform）
报酬区间：{rate_range}
对外话题（不暴露客户/课题）：{topic_obfuscated}

接下来确认一下沟通话术 —— 两个版本任选：

▸ 版本 1 · social 建联型
  先加好友，加上后再聊项目。connect note 不提付费、不提课题，纯打招呼。
  适合：高价值/敏感候选人，转化率高但周期长。
  预览：
    {渲染 type1_friendly 的 connect_message，candidate 示例用 Emma}

▸ 版本 2 · 开门见山访谈型【建议】
  connect note 一句话说清楚：付费 + 课题方向 + 想约个 60-min 匿名通话 + 索取邮箱。
  适合：目标明确、想快速筛出愿意接的专家。
  预览：
    {渲染 type2_direct 的 connect_message，candidate 示例用 Emma}

（还有版本 3 · 详细背景版，主要用于 InMail 或建联后 follow-up，本次不展示，需要再说）

请问是否要修改？任何字段都可以调（话术风格、rate、sender、对外话题、措辞）。

⚠️ 注意：本次确认后我只去跑搜索 + 生成名单，不会发任何消息。等名单出来你再最终确认人选和话术，确认后我才会发 Connect。
```

## 渲染要点

- **不要**用"固定部分/可配置部分"这种内部分类标签，对用户不友好。
- **背景段** 一行说清"为谁、做什么、谁来发"，让用户秒懂上下文。
- **话术段** 重点在两个版本的对比预览（type1 / type2），type3 默认折叠提一句即可。
- **结尾** 必须明确强调"现在不发消息，名单出来后还会再确认"，缓解用户对自动化操作的担忧。

## 用户回应处理

| 用户回应 | 动作 |
|---|---|
| "确认" / "全部沿用" | 把建议填回 `project_config`，立即开跑 Phase 2（不要再问"开始吗"） |
| "用 type2" / "话题改成 X" / "换成 Zadie" / "rate 改 200-500" | 更新对应字段，输出受影响的部分让用户复核 |
| 提供新 connect note 措辞 | 更新所选模板 `connect_message` 的运行时副本（仅本次寻访生效，不写回 JSON） |

## 默认值缓存策略（重要）

- `sender_profile_key` / `style` / `rate_range`：**保留 JSON 默认值**，本次临时切换不写回。
- `topic_specific` / `topic_obfuscated`：每次寻访都根据当前项目重新生成，JSON 中保持空字符串。
- 这样下次寻访的 Phase 1.5 默认开局始终是同一套（如 Yujia + 默认 rate），但 topic 永远是新项目的。
