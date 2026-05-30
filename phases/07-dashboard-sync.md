# Phase 7 · 同步到 Master Dashboard

发送完毕后，先保存当批次 Excel，再同步到 master dashboard `~/.linkedin-talent/dashboard.xlsx`。Dashboard 是跨批次累计的人选记录中心。

详细列定义参见 `lib/dashboard-schema.json`，**首次运行**自动创建空模板（含 Sheet1 + Sheet2 表头）。

## 同步合并伪代码

```python
def sync_to_dashboard(batch_candidates, batch_meta):
    dashboard = load_or_create('~/.linkedin-talent/dashboard.xlsx')

    # Sheet 2: append 当批次记录
    dashboard.sheet2.append_row(batch_meta)

    # Sheet 1: upsert 每个候选人（key=profile_url）
    existing = {row['LinkedIn URL']: row for row in dashboard.sheet1.rows}
    for cand in batch_candidates:
        if cand.profile_url in existing:
            row = existing[cand.profile_url]
            row['tier']         = min(row['tier'], cand.tier)             # 取最高 tier
            row['推荐度']        = tierToStars(row['tier'])
            row['命中信息']      = merge_hits(row['命中信息'], cand.hits)
            row['最近出现批次']  = batch_meta.batch_id
            row['出现次数']     += 1
            # Connect 状态：本次实际触达过才更新；否则保留
            if cand.connect_status in ('已发送', 'CANT_RESEND', '失败'):
                row['Connect 状态'] = cand.connect_status
                if cand.connect_status == '已发送' and not row['邀请发出时间']:
                    row['邀请发出时间'] = now_str()
            row['当前公司 · 职位'] = cand.current_company_title
            row['目标经历摘要']   = cand.target_experience
            row['备注']           = merge_notes(row['备注'], cand.filter_reason)
        else:
            row = new_row(cand, batch_meta.batch_id, first_appearance=True, count=1)
            dashboard.sheet1.append(row)

    apply_styles(dashboard)        # 重新应用 tier 配色 + 表头样式
    dashboard.save()
```

## 样式约定（与单批次 Excel 一致）

参见 `lib/dashboard-schema.json` 的 `styles`：
- Sheet1 行背景按 tier：tier1 绿 / tier2 蓝 / tier3 无
- Connect 状态列额外按值上色：已接受 黄 / 已 follow-up 浅蓝
- 表头 `4472C4` 白粗体；F/G/O 列 wrap_text=True；冻结首行
- Sheet1 默认按"最近出现批次"降序，再按 tier 升序
- Sheet2 默认按时间降序

## Phase 4（未来 follow-up 监测，未实现）

Dashboard schema 中 M / N 列预留：
- M「接受时间」：监测 sentInvitations 接受后回填
- N「Follow-up 时间」：发送 follow-up 后回填
- K「Connect 状态」：追加"已接受"/"已 follow-up"

当前不实现，仅留位。
