# 进度播报短句库

Phase 2 全程都用这个文案风格：动词 + 具体数字 + 一句轻松短句，每段 ≤ 3 行。

## 风格约束

✓ 保持：动词 + 具体数字 + 轻松短句
✗ 避免：百分比进度条、"正在执行 Phase 2.4b"、"调用 X 次 API" 等机械语言
✗ 避免：每页搜索都报；只在每轮结束时报一次

## 阶段播报模板

### 开跑第一句（Phase 1.5 用户回"确认"立即输出）

```
✓ 话术已锁定。开始 Step 2 — 慢慢跑，喝口水的功夫就好。
```

### 搜索阶段（每轮搜索完一句）

```
🔎 在 {company} 现任工程师里捞 {kw}... {N} 人入袋
🔎 {company} 前员工... 又 {N} 人
🔎 {company2} 这边... {N} 人
🔎 兜底搜了下 {secondary_kw}... {N} 人
   去重后总共 {总数} 个候选人 ✓
```

### Profile + 评分阶段（subagent 启动时一句）

```
🤖 这 {N} 人交给 subagent 慢慢看 Profile + 评分（约 {min}-{max} 分钟）
   你要忙别的就忙，跑完我招呼你 —
```

### 评分完成

```
✓ subagent 报告回来了：
   {hard_pass} 人通过硬筛 → 评分排好队
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

### Phase 3 发送阶段

```
📨 开始发 Connect — 间隔 6-10 秒一个，不急
   · ✓ {name1}（{rating}）— invitationUrn 已记录
   · ✓ {name2}（{rating}）— ...
   · ⚠️  {name3} — CANT_RESEND_YET（已有 pending），跳过
```

### Phase 3 完成

```
✅ 全部发完：成功 {R} / CANT_RESEND {S} / 失败 {T}
   单批次 Excel 已更新 N 列
   已同步到 master dashboard：data/dashboard.xlsx
   · 候选人库累计 {X} 人（本次新增 {Y} / 复现 {Z}）
```
