# Phase 1.5 · 模板与课题确认（强制步骤）

读取 `lib/connect-templates.json`，按 `templates/confirm-1-5.md` 渲染单条消息发给用户。

## 流程

1. **自动生成 `topic_obfuscated`** — 从 `topic_specific` 提炼一个泛行业说法（参见 `templates/confirm-1-5.md` 的对照示例）
2. **渲染确认消息** — 包含「固定部分」「可配置部分」「Connect note 预览」三段
3. **等用户回应**：
   - "确认" / "全部沿用" → 立即开跑 Phase 2，不要再问"开始吗"
   - "用 type2" / "话题改成 X" / "换成 Zadie" → 更新对应字段，输出受影响段让用户复核
   - 提供新 connect note → 更新所选模板 `connect_message` 的运行时副本（不写回 JSON）

## 默认值缓存策略（重要）

- `sender_profile_key` / `style` / `rate_range`：**保留 JSON 默认值**，本次临时切换不写回。
- `topic_specific` / `topic_obfuscated`：每次寻访都重新生成，JSON 中保持空字符串。
- 这样下次寻访默认开局始终是同一套（如 Yujia + 默认 rate），但 topic 永远是新项目的。

## 写入位置

确认后将 `project_config` 内联到本次寻访的运行时上下文（不持久化到 JSON 文件，避免污染下次默认值），用于 Phase 2.6 渲染话术。

## 进入 Phase 2 的第一句话

```
✓ 话术已锁定。开始 Step 2 — 慢慢跑，喝口水的功夫就好。
```
