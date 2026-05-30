# Phase 6 · 发送 Connect

播报风格见 `templates/broadcast.md` 的 "Phase 3 发送阶段" 段（实际就是这一阶段，命名延续旧版）。

## 6.1 发送前提

- 用户已在 Phase 5 中确认所有话术（Excel Q 列）
- 跳过 connect_status="skip" 的候选人

## 6.2 逐个发送（间隔 6-10s 随机）

`lib/voyager.js` 的 `sendConnectScript(profileUrn, note)` 生成发送脚本。

调用：`opencli browser linkedin eval "<sendConnectScript 输出的脚本>"`

参数：
- `profileUrn` — 候选人 URN（如 `urn:li:fsd_profile:ACoAA...`）
- `note` — 用户确认过的话术

## 6.3 结果判断

用 `parseConnectResult(result)` 解析（详见 `lib/safety.json` 错误码）：

| 结果 | 处理 | Excel S 列 |
|---|---|---|
| 200 + invitationUrn | 成功 | 已发送 |
| 400 + CANT_RESEND_YET | 已有 pending，跳过 | CANT_RESEND |
| 400 + WEEKLY_INVITATION_LIMIT_EXCEEDED | 周上限 | 失败，**整个 Phase 6 立即停止** |
| 401 / 403 / 429 | session 失效 / 被限制 / 频率限制 | **立即停止** |

每发完一个立即更新 Excel S 列（与 R 列发送状态可同时维护）。

## 6.4 最终输出

```
LinkedIn 寻访完成（batch_id: search_YYYYMMDD_HHMMSS）：
- 搜索：N 人（共 K 次 API 调用）
- Profile 获取：M 人
- 筛选通过：P 人（Tier1: a / Tier2: b / Tier3: c）
- 用户确认发送：Q 人
- 成功：R 人 / CANT_RESEND：S 人 / 失败：T 人
- 当批次 Excel：~/Downloads/linkedin_search_{batch_id}.xlsx
- Master Dashboard：~/.linkedin-talent/dashboard.xlsx
  · 候选人库累计 X 人（本次新增 Y / 复现 Z）
  · 批次索引共 K 条
```
