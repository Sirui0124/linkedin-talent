# Phase 5 · Review HTML + 解析决策

**唯一 review 通道**：浏览器 Dashboard 标记决策 → 复制 vanity ID 列表粘回 CLI。

## 5.1 生成 Review HTML

落地路径：`~/Downloads/review_{batch_id}.html`，单文件 HTML（无外部依赖、双击即可打开）。

生成后立即用 `open` 打开浏览器：
```bash
open ~/Downloads/review_YYYYMMDD_HHMMSS.html
```

### HTML 整体布局

左右分栏（flex），左侧 280px 固定宽度列表 + 右侧自适应详情面板。

---

### 左侧列表区

每人一行，紧凑排列。结构：

```
[tier 色条 3px] 姓名
                小字: current_title · Xyr
```

- **tier 色条**：左边缘 3px 竖线，tier1=#4CAF50, tier2=#2196F3, tier3=#9E9E9E
- **姓名**：14px，深色
- **副信息**：12px 灰色，格式 `{company} · {current_title} · {totalYears}yr`
  - totalYears = 当前年份 - 最早 position.startYear（从 profile 计算）
- **不显示分数**
- 当前选中行高亮背景
- 行高 ~52px，确保紧凑

**列表顶部**：
- 搜索框（按姓名/公司/headline 实时过滤）
- tier 筛选 chips：`[T1 a] [T2 b] [T3 c] [全部]`

**列表底部状态标签**：
- 每行右侧小圆点指示状态：绿色=建联，红色=不准确，无=未评价

---

### 右侧详情面板

选中某人后展开，从上到下依次：

#### 区域 0 · 人选头部信息

```
Emma Lin    BEOL Integration Engineer @ TSMC · 7yr         LinkedIn ↗
```

- 姓名（15px 加粗）+ title @ company · Xyr（12px 灰色）+ LinkedIn 链接（右对齐，点击跳转 profile 页）

#### 区域 1 · 建联话术（直接可编辑文本框）

```
┌─────────────────────────────────────────────────────────────────────┐
│                                              [建联] [不准确]          │
│  ┌─ textarea（11px, 3行高, 直接可编辑, 无需展开） ────────────────┐  │
│  │ Hi Emma, I'm Zadie at Funda.ai...                              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                        245/290       │
└─────────────────────────────────────────────────────────────────────┘
```

- 默认即为可编辑 textarea（不折叠），高度 ~52px（约 3 行）
- 右上角两个按钮：`建联` / `不准确`（互斥，再点取消）
- 下方右对齐字符数（>290 红色）

#### 区域 2 · 匹配度 + 命中信号（同一行左右两栏）

```
┌─────────────────────────────┬─────────────────────────────┐
│  匹配度                       │  命中/缺失信号                │
│                              │                              │
│  公司 100 · 课题 85 ·         │  ✓ TSMC 现任                 │
│  资历 90 · 加分 50            │  ✓ title 含 BEOL             │
│                              │  ✓ kw: interconnect          │
│  AI评价：TSMC 现任 BEOL 工程  │                              │
│  师，7年经验，关键词高度匹配   │  ✗ 未提及 Ruthenium 量产       │
└─────────────────────────────┴─────────────────────────────┘
```

- 左栏：维度分数以纯文字展示「公司 100 · 课题 85 · 资历 90 · 加分 50」（数字颜色：≥75 绿, 50-74 蓝, <50 橙）
- 左栏下方：AI reasoning 斜体灰色
- 右栏：matched_signals 用绿色 ✓，missed_signals 用灰色 ✗

#### 区域 3 · 工作经历 + 学历技能（LinkedIn 风格）

```
工作经历
─────────
🏢 TSMC · BEOL Integration Engineer
   2018 - 至今 (7yr)

🏢 Intel · Process Engineer
   2014 - 2018 (4yr)

学历
─────────
🎓 Stanford University · MS · Materials Science
   2012 - 2014

🎓 Tsinghua University · BS · Physics
   2008 - 2012

技能
─────────
[BEOL] [Ruthenium] [CVD] [PVD] [Process Integration] [Metallization]
```

- 经历：公司 · 职位 换行显示 startYear - endYear (Xyr)
  - endYear 为空 → "至今"
  - 年限 = endYear(或当前年) - startYear
- 学历：学校 · 学位 · 专业 换行显示 startYear - endYear
  - 年份从 education.startYear / education.endYear 取
- 技能：tag chips 样式，横排 wrap

#### 区域 4 · 评分理由（底部小字）

- 12px 灰色，显示 `reasoning` 字段
- 不加标题，直接一段小字

---

### 顶部 Sticky Bar

- 批次信息：batch_id / 课题 / 公司 / 关键词 / 共 P 人
- 快捷操作：`全部建联` / `清除所有标记`

### 底部固定 Action Bar

```
┌──────────────────────────────────────────────────────────────┐
│  建联 X / 不准确 Y / 未评价 Z          [复制建联名单] [导出文件] │
└──────────────────────────────────────────────────────────────┘
```

- 左侧：实时统计三种状态人数
- `复制建联名单`（主按钮）→ 复制所有标记为"建联"的人的 vanity ID（每人一行）
- `导出文件`（次按钮）→ 下载 `review_{batch_id}_decisions.json`，内容含 vanity + note + edited

**复制到剪贴板的格式**（只含状态=建联的人）：
```
emma-lin-xxx
david-chen-xxx
mark-lee-xxx
```

用户直接粘贴到 Claude Code 即可触发 Phase 6 建联。

---

## 5.2 导出 JSON 文件 schema

「导出文件」按钮下载的 JSON：

```json
{
  "batch_id": "search_20260530_143000",
  "version": 2,
  "decisions": [
    {"vanity": "emma-lin-xxx",   "action": "connect", "note": "Hi Emma, ...", "edited": true},
    {"vanity": "david-chen-xxx", "action": "connect", "note": "Hi David, ...", "edited": false},
    {"vanity": "wei-zhang-xxx",  "action": "reject"},
    {"vanity": "mark-lee-xxx",   "action": "skip"}
  ]
}
```

字段约定：
- `vanity` — 必填
- `action` — `"connect"` / `"reject"` / `"skip"`
  - connect = 用户点了「建联」
  - reject = 用户点了「不准确」
  - skip = 用户未操作（默认）
- `note` — 仅 action=connect 时有值，最终话术
- `edited` — boolean，用户是否修改过话术

## 5.3 终端输出

按 `templates/broadcast.md` 的"Excel + Dashboard 弹出"段渲染。

## 5.4 解析用户粘贴的 vanity 列表

收到用户粘贴 vanity 列表后（每行一个 vanity）：

1. 按 vanity 在内存 candidate 库 lookup，未命中的收集到 unmatched 列表
2. 对命中者：标记 `connect_status="待发送"`
3. 检查是否有 `edited=true` 的话术需同步回 Excel Q 列
4. 输出确认：

```
已确认建联名单：
- 待发送：Q 人
- 未识别 vanity：U 人（已忽略）
- 话术被修改：M 人（已同步 Excel）

确认开始 Phase 6 发送吗？
```

**必须**等用户最终确认后才进入 Phase 6。

## 5.5 话术同步 Excel

当 decisions JSON 中某人 `edited=true`：
- 将其 `note` 写回对应 Excel 文件 Q 列（建联话术）
- 标记写入时间到 T 列备注
