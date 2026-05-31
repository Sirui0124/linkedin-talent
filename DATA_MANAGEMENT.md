# LinkedIn Talent Data Management Setup

## ✅ 已完成的改进

### 1. 数据目录结构

数据落到 skill 目录内的 `data/`，路径在 `lib/paths.js` 单点声明，并由 `.gitignore` 排除，不同步到 GitHub：

```
data/
├── dashboard.xlsx                              ← master dashboard（跨批次累计）
├── batches/   linkedin_<batchId>.xlsx          ← 单批次结果 Excel
├── criteria/  <batchId>.json                   ← Phase 1 解析后的标准
├── exports/   raw_<batchId>.json               ← Phase 2 召回原始数据
├── exports/   phase3_<batchId>.json            ← Phase 3 评分结果
├── decisions/ decisions_<batchId>.json         ← Phase 5 用户确认结果
└── archive/   <旧文件>
```

### 2. 文件命名规范

由 `lib/naming.js` 统一生成与解析：

- batch_id 格式：`search_<YYYYMMDD>_<HHMM>[_<LABEL>]`
  - 示例：`search_20260530_1314` / `search_20260530_1314_BEOL`
- 派生文件名：
  - 单批次 Excel：`linkedin_<batchId>.xlsx`
  - 评分结果：    `phase3_<batchId>.json`
  - 用户决策：    `decisions_<batchId>.json`
  - 原始召回：    `raw_<batchId>.json`

### 3. 数据管理工具

`scripts/data-manager.sh`：

- `list` (默认) — 按 batch_id 列出所有批次（含决策状态）
- `archive [days]` — 归档 N 天前的文件（默认 90 天）
- `check` — 校验文件命名合规性

### 4. Master Dashboard

跨批次累计写入 `data/dashboard.xlsx`（首次运行自动创建空模板，含 Sheet1 候选人库 + Sheet2 批次索引）。完整列定义见 `lib/dashboard-schema.json`。

合并伪代码见 `phases/07-dashboard-sync.md`。

## 🎯 核心特性

- **数据不进 GitHub**：`data/` 位于 skill 包内，方便 Dashboard 默认打开；同时被 `.gitignore` 排除，不会被 git 追踪。也可以通过环境变量 `LINKEDIN_TALENT_HOME` 重定向。
- **路径单一来源**：所有路径在 `lib/paths.js`；批次命名在 `lib/naming.js`；Excel 列契约在 `lib/excel-schema.json`（`schema-check.mjs` 守护）
- **状态追踪**：通过 `decisions/decisions_<batchId>.json` 是否存在判断批次状态（Draft / Ready）
- **跨平台**：`stat` 命令在 macOS / Linux 上行为不同，data-manager.sh 已做兼容处理

## 📋 使用示例

```bash
# 查看当前所有批次
bash scripts/data-manager.sh list

# 归档 90 天前的文件
bash scripts/data-manager.sh archive 90

# 检查命名规范
bash scripts/data-manager.sh check

# 自定义数据根目录（多账号场景）
LINKEDIN_TALENT_HOME=data-alt bash scripts/data-manager.sh list
```

## 🔧 配置文件

- `lib/paths.js` — 路径单点定义（编程接口）
- `lib/naming.js` — batch_id 与文件名生成/解析
- `scripts/data-manager.sh` — 命令行管理工具
- `lib/excel-schema.json` — 单批次 Excel 列契约（`schema-check.mjs` 守护一致性）
- `lib/dashboard-schema.json` — Master Dashboard 列契约
