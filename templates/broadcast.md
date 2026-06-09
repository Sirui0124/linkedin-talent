# 进度播报短句库

搜索和评分全程都用这个文案风格：动词 + 具体数字 + 一句轻松短句，每段 ≤ 3 行。

## 风格约束

✓ 保持：动词 + 具体数字 + 轻松短句
✗ 避免：百分比进度条、内部阶段编号、API 调用次数、评分层级黑话等机械语言
✗ 避免：每页搜索都报；只在每轮结束时报一次
✗ 避免：中途展示未完成 Dashboard。只有搜索、Profile 拉取、筛选评分、逐人话术生成全部完成后，才给 Review Dashboard / Excel。

## 必须说明搜索条件

用户确认策略后、真正调用 LinkedIn 前，先用自然语言列出本轮会先跑的搜索入口：

```
这轮先按这些入口搜：
1. {company/topic/persona}：{keyword_1}、{keyword_2}
2. {company/topic/persona}：{keyword_3}、{keyword_4}

达到校准目标会自动停；没跑到的 fallback 不会混进结果里。跑完我会告诉你实际执行了哪些词。
```

最终给 Dashboard 时，必须同时说明：
- 实际执行了哪些搜索词/公司入口
- 哪些计划内搜索词没有执行，以及为什么没有执行（例如已达到目标人数）
- 看板是完整批次，不是中间产物

## 阶段播报模板

### 开跑第一句（用户确认策略和话术方向后立即输出）

```
✓ 策略和话术方向已确认。开始搜索 — 慢慢跑，喝口水的功夫就好。
```

### 搜索阶段（每轮搜索完一句）

```
🔎 在 {company} 现任工程师里捞 {kw}... {N} 人入袋
🔎 {company} 前员工... 又 {N} 人
🔎 {company2} 这边... {N} 人
🔎 兜底搜了下 {secondary_kw}... {N} 人
   去重后总共 {总数} 个候选人 ✓
```

### Profile + AI 评分阶段

```
🤖 这 {N} 人开始做 AI 评分（约 {min}-{max} 分钟）
   你要忙别的就忙，跑完我招呼你 —
```

### 评分完成

```
✓ AI 评分回来了：
   {hard_pass} 人通过基础筛选 → 评分排好队
   Tier1 ⭐⭐⭐ {a} 人 / Tier2 ⭐⭐ {b} 人 / Tier3 ⭐ {c} 人
```

### Excel + Dashboard 弹出

```
🎯 跑完了 — 看看战利品

   找到 {N} 人 → 把方向不对的过滤掉 → 评分排好队
   最后给你筛出 {P} 个值得发的人
       ⭐⭐⭐ Tier1: {a} 人（最对口，建议都发）
       ⭐⭐  Tier2: {b} 人（不错的备选）
       ⭐   Tier3: {c} 人（沾点边，可选发）

📂 已保存：
   · Excel：~/Downloads/linkedin_search_{batch_id}.xlsx
   · Dashboard 已自动打开（Review 页）→ 在浏览器里看吧

【Tier1 速览（前 5）】
   #1 {name} · {current_company} · {current_title} (score {score})
   #2 ...

接下来在 Dashboard 上：
   · 取消勾选不想发的人
   · 想改话术直接编辑（字符数会实时显示）
   · 点底部「复制结果到剪贴板」 → 粘回这里
   我就帮你发了。

【字符数检查】全部 ≤ 290 ✓
```

### 字符数告警（如有超长话术）

```
⚠️ #{idx1}、#{idx2} 字符数超 290，Dashboard 上会标红，记得改短再粘回来
```

### 发送 Connect 阶段

```
📨 开始发 Connect — 间隔 6-10 秒一个，不急
   · ✓ {name1}（{rating}）— invitationUrn 已记录
   · ✓ {name2}（{rating}）— ...
   · ⚠️  {name3} — CANT_RESEND_YET（已有 pending），跳过
```

### 发送完成

```
✅ 全部发完：成功 {R} / CANT_RESEND {S} / 失败 {T}
   单批次 Excel 已更新 N 列
   已同步到 master dashboard：data/dashboard.xlsx
   · 候选人库累计 {X} 人（本次新增 {Y} / 复现 {Z}）
```
