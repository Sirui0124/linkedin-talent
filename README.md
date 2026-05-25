# LinkedIn Talent Skill

LinkedIn 人才寻访与建联完整链路。

## 目录结构

```
linkedin-talent/
├── SKILL.md              # 主文档（SOP 流程）
├── README.md             # 本文件
├── lib/
│   ├── config.js         # 配置：公司ID映射、搜索策略、错误码
│   └── voyager.js        # API 封装：搜索、Profile、Connect 脚本模板
└── scripts/
    ├── install-opencli.sh    # opencli 一键安装
    └── check-update.sh       # opencli 版本检查
```

## 快速开始

### 1. 安装 opencli

```bash
# 方式一：使用安装脚本
~/.claude/skills/linkedin-talent/scripts/install-opencli.sh

# 方式二：npm 全局安装
npm install -g @jackwener/opencli
```

### 2. 安装 Chrome 扩展

1. 打开 Chrome Web Store
2. 搜索 "opencli browser bridge"
3. 点击「添加至 Chrome」
4. 确保扩展已启用

### 3. 验证连接

```bash
opencli doctor
```

### 4. 使用 Skill

```
/linkedin-talent 帮我在 LinkedIn 找 strategy analyst，目标 Tencent
```

## 模块说明

### lib/config.js

配置文件，包含：
- `COMPANY_ID_MAP` — 公司 ID 映射表
- `SEARCH_STRATEGIES` — 搜索策略枚举
- `DEFAULT_SEARCH_CONFIG` — 默认搜索配置
- `ERROR_CODES` — 错误码定义
- `CONNECT_STATUS` — 连接状态枚举

### lib/voyager.js

Voyager API 封装，提供：
- `searchCandidatesScript(start, keywords, companyFilter)` — 搜索脚本
- `getProfileScript(vanity)` — 获取 Profile 脚本
- `sendConnectScript(profileUrn, note)` — 发送 Connect 脚本
- `findCompanyIdScript(companyName)` — 查找公司 ID 脚本
- `parseSearchError(result)` — 解析搜索错误
- `parseConnectResult(result)` — 解析 Connect 结果

### scripts/install-opencli.sh

一键安装脚本，功能：
- 检查 Node.js 环境
- 安装 @jackwener/opencli
- 验证安装
- 引导安装 Chrome 扩展

### scripts/check-update.sh

版本检查脚本，支持：
- 比较当前版本与最新版本
- `--auto-update` 参数自动更新

## 扩展公司 ID

编辑 `lib/config.js` 中的 `COMPANY_ID_MAP`：

```javascript
export const COMPANY_ID_MAP = {
  // 添加新公司
  'NewCompany': 123456,
  '新公司': 123456,
};
```

## 安全规则

- 搜索翻页间隔：3-5s
- Profile 请求间隔：3-5s
- Connect 请求间隔：6-10s
- 单次搜索上限：1000 人
- 遇到 401/403/429 立即停止

## 错误处理

| HTTP | Code | 处理 |
|------|------|------|
| 401 | — | Session 失效，重新登录 |
| 403 | — | 被限制，停止操作 |
| 429 | — | 频率限制，等待 1h+ |
| 400 | CANT_RESEND_YET | 跳过该候选人 |
| 400 | WEEKLY_LIMIT | 停止全部发送 |

## 数据存储

- JSON 库：`~/.linkedin-talent/data/candidates.json`
- Excel 输出：`~/Downloads/linkedin_search_YYYYMMDD_HHMMSS.xlsx`
