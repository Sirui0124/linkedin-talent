# Phase 5 · 固定 Dashboard + Excel 载入

**唯一 review 通道**：打开固定 Dashboard → 载入当批 Excel → 浏览器里标记决策 → 复制 vanity ID 列表或导出 decisions JSON 粘回 CLI。

## 5.1 固定 Dashboard

不再为每个 batch 生成新的 HTML。Review 页面始终使用同一个模板：

```bash
open templates/review-dashboard.html
```

Phase 4 只生成/覆盖当批 Excel：

```text
data/batches/linkedin_<batch_id>.xlsx
```

然后自动打开固定 Dashboard。用户在页面顶部点击「加载 Excel」，选择当批或历史批次 Excel。这样：

- 样式和交互永远复用最新模板
- 历史 Excel 可以用最新 Dashboard 重新打开
- skill 更新不会生成一堆旧版 HTML
- 用户本地历史数据仍保留在 `data/batches/`

## 5.2 Excel 载入要求

Dashboard 从 Excel 的「候选人」sheet 读取数据。列契约见 `lib/excel-schema.json`，关键列：

```text
Tier / 总分 / 分项评分 / 姓名 / 当前职位 / 当前公司 /
目标公司经历 / 其他经历 / 地点 / 评分理由 /
matched_signals / missed_signals / highlight_for_outreach /
Connect 话术 / Profile URL / Vanity / URN / Connect状态
```

旧批次兼容：

- `分项评分` 中的 `课题` 会映射为 `岗位`
- `资历` / `目标岗时长` 会映射为目标岗时长维度
- 只要存在 `候选人` sheet 且有 `姓名` 或 `Vanity`，Dashboard 就能载入

## 5.3 Dashboard 布局

左右分栏：

- 左侧：候选人列表、搜索框、Tier 筛选
- 右侧：候选人详情、Connect 话术、匹配度、命中/缺失信号、工作经历
- 底部：建联 / 不准确 / 未评价 统计，复制名单与导出按钮

顶部显示当前载入的 Excel 文件名和候选人数。

## 5.4 导出 JSON 文件 schema

「导出文件」按钮下载的 JSON：

```json
{
  "batch_id": "dashboard",
  "version": 2,
  "decisions": [
    {"vanity": "emma-lin-xxx", "action": "connect", "note": "Hi Emma, ...", "edited": true},
    {"vanity": "david-chen-xxx", "action": "connect", "note": "Hi David, ...", "edited": false},
    {"vanity": "wei-zhang-xxx", "action": "reject"},
    {"vanity": "mark-lee-xxx", "action": "skip"}
  ]
}
```

字段约定：

- `vanity` — 必填
- `action` — `"connect"` / `"reject"` / `"skip"`
- `note` — 仅 action=connect 时有值，最终话术
- `edited` — boolean，用户是否修改过话术

## 5.5 解析用户粘贴的 vanity 列表

收到用户粘贴 vanity 列表后（每行一个 vanity）：

1. 按 vanity 在当批 candidate 库 lookup，未命中的收集到 unmatched 列表
2. 对命中者：标记 `connect_status="待发送"`
3. 检查是否有 `edited=true` 的话术需同步回 Excel Q 列
4. 输出确认：

```text
已确认建联名单：
- 待发送：Q 人
- 未识别 vanity：U 人（已忽略）
- 话术被修改：M 人（已同步 Excel）

确认开始 Phase 6 发送吗？
```

**必须**等用户最终确认后才进入 Phase 6。
