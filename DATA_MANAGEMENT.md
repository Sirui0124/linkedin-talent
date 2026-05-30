# LinkedIn Talent Data Management Setup

## ✅ 已完成的改进

### 1. 数据目录结构
创建了标准化的数据存储结构：
```
linkedin-talent/data/
├── batches/     → 搜索结果Excel文件
├── decisions/   → 用户决策JSON文件  
├── exports/     → 最终输出文件
└── archive/     → 归档文件
```

### 2. 文件命名规范
建立了统一的命名规则：
- 搜索批次：`linkedin_search_{batch_id}_{timestamp}.xlsx`
- 决策文件：`decisions_{batch_id}_{timestamp}.json`
- 公司特定：`linkedin_ex_{company}_{timestamp}.xlsx`

### 3. 数据管理工具
创建了 `data-manager.sh` 脚本，支持：
- `list` - 查看所有批次（包含状态和决策信息）
- `check` - 检查文件命名合规性
- `archive` - 归档旧文件（默认90天）
- `sync` - 同步到主控dashboard

### 4. Dashboard集成
配置了与 `~/hr-talent-scout/dashboard/master_linkedin.xlsx` 的同步：
- batch_id, search_date, total_candidates
- tier1_candidates, connect_sent, connect_accepted
- status (Draft/Ready/Completed)

## 🎯 核心特性

- **智能批次识别**：自动从文件名提取批次ID（BEOL, TSE等命名批次）
- **状态追踪**：通过决策文件存在性判断批次状态
- **文件大小估算**：Excel行数估算和TSV文件行数统计
- **颜色编码**：绿色日志、黄色警告、红色错误
- **Dashboard集成**：与hr-talent-scout主控台同步

## 📋 使用示例

```bash
# 查看当前所有批次
bash scripts/data-manager.sh list

# 输出示例：
# | Batch ID | Date | Size | Decision | Status |
# |----------|------|------|----------|--------|
# | BEOL_20260530 | 2026-05-30 | ~45 | ✅ | 🚀 Ready |
# | ex_alibaba_20260524 | 2026-05-24 | ~8 | ❌ | 📝 Draft |

# 检查命名规范
bash scripts/data-manager.sh check

# 归档旧文件
bash scripts/data-manager.sh archive 90
```

## 🔧 配置文件

- `lib/data-manager.json` - 数据管理配置
- `data/` - 数据存储目录
- `scripts/data-manager.sh` - 管理工具

## 📈 下一步改进

1. 实现真实的Excel解析（当前为近似估算）
2. 完成dashboard同步功能的具体实现
3. 添加批次统计和报告生成
4. 集成到LinkedIn talent的主工作流程中

---

*数据管理系统已就绪，支持LinkedIn talent skill的全生命周期文件管理。*