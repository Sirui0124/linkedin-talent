---
name: linkedin-talent
description: LinkedIn 人才寻访与建联完整链路。搜索候选人→获取Profile→输出Excel→用户确认→批量发送Connect。通过 opencli browser + Voyager API 实现。触发词：「LinkedIn 找人」「LinkedIn 搜索」「LinkedIn connect」「LinkedIn 加人」「领英寻访」「领英搜索」。
platforms: [claude]
tools: Bash, Read, Write
load: manual
---

# LinkedIn 人才寻访 — 完整链路 SOP

## 前置：环境检查

### 1. 检查 opencli 安装

```bash
opencli --version 2>&1 || echo "NOT_INSTALLED"
```

如果未安装，执行一键安装：
```bash
~/.claude/skills/linkedin-talent/scripts/install-opencli.sh
```

或通过 npm 安装：
```bash
npm install -g @jackwener/opencli
```

### 2. 检查 Chrome 扩展连接

```bash
opencli doctor 2>&1 | head -5
```

如果 extension 未连接 → 提示用户打开 Chrome 并确保扩展已启用。

### 3. 验证 LinkedIn 登录状态

```bash
opencli browser linkedin open "https://www.linkedin.com/feed/" 2>&1
```

等待 2s 后检查：
```bash
opencli browser linkedin eval "(() => JSON.stringify({url: location.href, ok: document.title.includes('Feed')}))()" 2>&1
```

如果 ok=false → 提示用户在 Chrome 中登录 LinkedIn，等待后重试。

---

## Phase 1: 解读用户标准

用户通常给出类似：「帮我在 LinkedIn 找 strategy analyst，目标 Tencent，筛掉目前在腾讯的，只要有咨询背景的」

Claude 需要解析出：

| 字段 | 示例 | 说明 |
|------|------|------|
| 目标公司 | Tencent | 搜索的锚点公司 |
| 岗位关键词 | Strategy Analyst | 搜索关键词 |
| 搜索策略 | currentCompany / pastCompany / keyword | 默认：keyword |
| 筛选标准 | 现在不在目标公司 + 有咨询背景 | 用于 Step 2 标记 |
| 自定义消息 | （用户提供或空） | 用于 Step 3 生成话术 |
| 搜索数量 | 默认 100 | 单次上限 1000 |

**搜索策略说明**：
- `currentCompany` — 当前在目标公司的人
- `pastCompany` — 曾在目标公司的人（⚠️ 需在精筛时排除仍在职者）
- `keyword` — 纯关键词搜索，无公司过滤

**解析完毕后，用一句话向用户确认理解**：
> 我理解的是：搜索关键词 "Strategy Analyst" + [策略] Tencent，筛选条件为"..."，搜索 N 人。确认后我开始搜索。

等用户确认后进入 Phase 2。

---

## Phase 2: 搜索 + Profile 获取 + 生成 Excel

### 2.1 公司 ID 映射

**引用配置文件**：`lib/config.js` 中的 `COMPANY_ID_MAP`

常用公司 ID（完整列表见配置文件）：
- Alibaba/阿里巴巴: 1538
- Tencent/腾讯: 5765
- ByteDance/字节跳动: 15525013
- Baidu/百度: 7555
- NetEase/网易: 5116
- McKinsey/麦肯锡: 1371
- Microsoft/微软: 1035
- Google/谷歌: 1441
- NVIDIA/英伟达: 3608
- Amazon/亚马逊: 1586
- Apple/苹果: 162479
- Meta/Facebook: 10667

如不在映射中，使用 `lib/voyager.js` 中的 `findCompanyIdScript(companyName)` 通过浏览器 typeahead 查找。

调用方式：`opencli browser linkedin eval "<findCompanyIdScript 输出的脚本>"`

> **注意**：typeahead API 偶尔返回 500。如果失败，优先使用上方公司 ID 映射表。对于不在映射中的公司，可以在 LinkedIn 网页搜索该公司后从 URL 中提取 company ID。

### 2.2 搜索（Voyager API 分页）

使用 `lib/voyager.js` 中的 `searchCandidatesScript(start, keywords, companyFilter)` 生成搜索脚本。

调用方式：`opencli browser linkedin eval "<searchCandidatesScript 输出的脚本>" 2>&1`

> **⚠️ CSRF 正则关键**：在 `opencli browser eval` 中，双引号需要用 `\\\"` 转义。正确模式为 `/JSESSIONID=\\\"?([^;\\\"]+)/`。不要用 `/JSESSIONID=\"?([^;\"]+)/`（shell 会吞掉引号导致 CSRF check failed）。

**companyFilter 参数**（传入 searchCandidatesScript）：
- 当前公司：`(key:currentCompany,value:List(5765)),`
- 前公司：`(key:pastCompany,value:List(1538)),`
- 多公司：`(key:currentCompany,value:List(1053,3608)),`
- 纯关键词：空字符串 `''`

**分页逻辑**：
1. 用户要求 N 人 → 计算需要 `ceil(N/20)` 页
2. 第 1 页 start=0，第 2 页 start=20...
3. 每页间隔 **3-5s**（随机）
4. 如果某页返回 results 为空 → 搜索结果已耗尽
5. 合并所有页的 results，按 vanity 去重
6. 如果返回 error 401/403/429 → **立即停止**

### 2.3 分层 Profile 获取策略

1. **初筛**：基于搜索结果中的 name + headline + location，由 Claude 快速判断
2. **完整 Profile**：仅对初筛通过（⭐⭐ 及以上）的候选人获取详情
3. **未通过候选人**：保留搜索基础信息，不获取完整 Profile

使用 `lib/voyager.js` 中的 `getProfileScript(vanity)` 生成 Profile 获取脚本。

调用方式：`opencli browser linkedin eval "<getProfileScript 输出的脚本>"`

> **⚠️ Profile API 返回数据注意**：`data.included` 数组可能包含多个 profile 对象（特别是有关联推荐的情况）。脚本已用 `inc.find(i => i.entityUrn.includes('fsd_profile') && i.firstName)` 取第一个匹配。如果返回的 firstName 与搜索结果中的 name 不一致，说明 API 返回了关联 profile，应标注"待验证"而非直接采信。

### 2.4 存储 JSON 到统一库

所有候选人数据存入 `~/.linkedin-talent/data/candidates.json`

**JSON 结构**：

```json
{
  "metadata": {
    "last_updated": "2026-05-25T14:30:00",
    "total_candidates": 25
  },
  "searches": [
    {
      "id": "search_20260525_143000",
      "timestamp": "2026-05-25T14:30:00",
      "query": {
        "keywords": "Strategy Analyst",
        "target_company": "Tencent",
        "company_id": "5765",
        "strategy": "currentCompany",
        "filter_criteria": "现在不在腾讯 + 有咨询背景"
      },
      "candidates": ["cand_001"]
    }
  ],
  "candidates": {
    "cand_001": {
      "id": "cand_001",
      "vanity": "aoxiang-alex-zhang-7020b2166",
      "urn": "urn:li:fsd_profile:ACoAA...",
      "profile_url": "https://www.linkedin.com/in/aoxiang-alex-zhang-7020b2166/",
      "first_name": "Aoxiang (Alex)",
      "last_name": "Zhang",
      "headline": "腾讯 - Game Strategy Analyst",
      "current_company": "腾讯",
      "current_title": "Game Strategy Analyst",
      "experience_history": "字节跳动·Strategy Analyst Intern(2018-2018) | ...",
      "education": "北京大学·Bachelor·Economics",
      "skills": ["数据分析", "SQL", "Python"],
      "is_at_target_company": true,
      "target_company_experience": "腾讯, 5年",
      "rating": "不符合",
      "filter_reason": "当前在目标公司",
      "connect_status": "待确认",
      "search_ids": ["search_20260525_143000"]
    }
  }
}
```

### 2.5 导出 Excel

从 JSON 库导出 Excel，保存到 `~/Downloads/linkedin_search_YYYYMMDD_HHMMSS.xlsx`

**Excel 包含两个 Sheet**：

#### Sheet 1: "筛选通过"

| 列 | 表头 | 说明 |
|----|------|------|
| A | 姓名 | first_name + " " + last_name |
| B | Headline | 原始 headline |
| C | 当前公司 | 当前所在公司名 |
| D | 当前职位 | 当前职位标题 |
| E | 目标经历 | 与搜索目标相关的经历（格式见下） |
| F | 其他经历 | 其余工作经历（格式见下） |
| G | 学历 | 学校 + 学位 + 专业 |
| H | 连接度 | 2度/3度 |
| I | LinkedIn URL | profile_url |
| J | 推荐度 | ⭐⭐⭐ / ⭐⭐ / ⭐ |
| K | 建联话术 | 为该候选人生成的个性化 Connect 消息（≤250字符） |
| L | 备注 | 推荐原因或待验证说明 |
| M | Connect状态 | 待确认/已发送/成功/失败 |

#### 经历输出格式（统一规范）

每段经历一行，格式固定为：
```
公司名 | 职位 | 起始年-结束年
```

多段经历用换行分隔。示例：
```
NVIDIA | Senior SWE | 2014-2017
Microsoft | Senior SWE | 2017-2018
Google | SWE | 2018-至今
```

**禁止**额外加工（如箭头、括号标注年数、中文描述等），保持纯事实平铺。

#### Sheet 2: "未通过"

| 列 | 表头 | 来源 |
|----|------|------|
| A | 姓名 | 搜索结果 name |
| B | Headline | 搜索结果 headline |
| C | Location | 搜索结果 location |
| D | 连接度 | 2度/3度 |
| E | LinkedIn URL | profile_url |
| F | 排除原因 | 排除理由 |

**推荐度规则**：
- ⭐⭐⭐ — 完全符合所有筛选条件，目标公司全职经历≥2年
- ⭐⭐ — 基本符合，有小瑕疵（如目标公司经历较短、岗位方向略偏）
- ⭐ — 搜索命中但需验证（Profile未获取/经历时间短/岗位相关但不完全匹配）
- 不符合 → 放入 Sheet 2（仅限岗位方向完全不相关的，如搜研发排除纯硬件）

**筛选宽松原则**：宁可多放⭐，不可误排。以下情况均应放入"筛选通过"Sheet：
- 搜索 API 命中了 pastCompany 但未获取详细 Profile → 标 ⭐ + "待验证"
- 岗位方向有相关度但不完全相同（如搜研发，Automotive AI 也算） → 标 ⭐
- 目标公司经历为实习（<1年） → 标 ⭐

**样式**：
- Sheet 1: ⭐⭐⭐ 行背景 `C6EFCE`，⭐⭐ 行背景 `DDEBF7`，⭐ 无特殊背景
- Sheet 2: 统一行背景 `F2F2F2`
- 表头行背景 `4472C4`，白色粗体
- 经历列启用自动换行（wrap_text=True, vertical=top）

### 2.6 生成建联话术（Excel 同步写入 K 列）

在生成 Excel 时，为每个筛选通过的候选人生成个性化 Connect 消息，写入 K 列。

#### 话术配置文件

**所有话术参数读取自** `lib/connect-templates.json`，包括：
- `sender` — 发送人身份信息（name, title, company, company_description）
- `templates` — 两种话术类型的模板 + follow-up 模板
- `personalization_rules` — 个性化亮点的选取规则和反面示例
- `rate_range` — 报酬区间
- `language_rules` — 语言选择规则

用户可直接编辑该 JSON 文件来更新企业信息、调整模板措辞、修改报酬等，无需每次口头说明。

#### 话术类型（每次搜索前向用户确认）

| 类型 | 场景 | 风格 |
|------|------|------|
| type1_friendly | 先加好友，连接后再说明目的 | 轻松自然，不提项目细节 |
| type2_direct | Connect 信息中直接提到付费研究咨询 | 开门见山，提及课题+付费 |

#### 话术结构

每条消息 = **模板骨架**（从配置文件读取）+ **个性化填充**（基于候选人 Profile），总长度 **200-300 字符**（从配置文件 min_chars/max_chars 读取）。

**变量说明**：
- `{firstName}` — 候选人名
- `{senderName}` — 从 `sender.name` 读取
- `{company}` — 从 `sender.company` 读取
- `{topic}` — 本次搜索的研究课题（Phase 1 确认）
- `{highlight}` — 从候选人 Profile 中提取的 1 个最相关亮点
- `{rateRange}` — 从 `rate_range` 读取（用于 follow-up）

#### 个性化亮点生成规则

从 `personalization_rules.highlight_sources` 中按优先级选取：
1. 候选人与本次课题最相关的职位+公司
2. 具体技术/领域专长
3. 相关领域年资

**禁止**使用 `personalization_rules.avoid` 中列出的泛泛表达。

#### 生成规则

1. 每个筛选通过的候选人都必须生成话术（包括 ⭐ 级别）
2. 如果 Profile 未获取（仅有搜索基础信息），基于 headline 生成
3. 话术语言遵循 `language_rules`：默认英文，候选人中文姓名/headline 则用中文
4. 生成后严格检查字符数，超出则压缩（优先缩短 highlight 部分）

### 2.7 向用户展示结果

Excel 生成后，输出 markdown 摘要表格 + **逐人话术预览**，供用户 review：

```
搜索完成，共获取 N 个 Profile，筛选通过 P 人。

| # | 姓名 | 当前职位@公司 | 推荐度 | 建联话术 |
|---|------|--------------|--------|---------|
| 1 | Emma Lin | Senior Analyst @ Alibaba | ⭐⭐⭐ | Hi Emma, I'm Yujia from FundaAI... |
| 2 | David Chen | Product Manager @ ByteDance | ⭐⭐ | Hi David, I'm Yujia from FundaAI... |
...

话术类型：类型2（直接专家访谈）
字符数检查：全部 ≤ 250 ✓

请 review：
1. 话术整体 OK？需要调整模板/语气/用词？
2. 某个候选人需要单独修改话术？（回复"#3 改成..."）
3. 要移除某些候选人不发送？
4. 确认无误，开始发送？
```

**必须等用户逐条确认话术后才进入 Phase 3。** 用户可以：
- 批量修改：如「所有话术把 FundaAI 改成 Funda.ai」
- 单独修改：如「#3 的话术改成 xxx」
- 删除候选人：如「#5 不发了」
- 确认发送：如「OK 发吧」

修改后重新输出受影响的行，再次等待确认。

---

## Phase 3: 发送 Connect（用户确认话术后执行）

### 3.1 发送前确认

进入 Phase 3 的前提：
- 用户已在 Phase 2.7 中 review 并确认了所有话术
- Excel K 列中的话术即为最终发送内容
- 如用户修改过话术，Excel 已同步更新

### 3.2 逐个发送（间隔 6-10s）

使用 `lib/voyager.js` 中的 `sendConnectScript(profileUrn, note)` 生成发送脚本。

调用方式：`opencli browser linkedin eval "<sendConnectScript 输出的脚本>"`

- `profileUrn` — 候选人的 URN（如 `urn:li:fsd_profile:ACoAA...`）
- `note` — K 列中用户确认过的话术内容

**结果判断**（使用 `parseConnectResult(result)` 解析）：
- 200 + `invitationUrn` → 成功
- 400 + `CANT_RESEND_YET` → 跳过
- 401/403/429 → **立即停止**

### 3.3 更新 Excel

发送完毕后重新保存 Excel，更新 J 列和 K 列。

---

## 安全规则

| 操作 | 间隔 |
|------|------|
| 搜索翻页之间 | 3-5s（随机） |
| Profile 之间 | 3-5s（随机） |
| Connect 之间 | 6-10s（随机） |
| 单次搜索上限 | 1000 人（Premium） |
| 遇 401/403/429 | **立即停止** |

---

## 错误码速查

| HTTP | Code | 含义 | 处理 |
|------|------|------|------|
| 200 | — | 成功 | 记录 invitationUrn |
| 400 | CANT_RESEND_YET | 已有 pending | 跳过 |
| 400 | WEEKLY_INVITATION_LIMIT_EXCEEDED | 周上限 | 停止全部 |
| 401 | — | Session 失效 | 停止，提示重新登录 |
| 403 | — | 被限制 | 停止 |
| 429 | — | 频率限制 | 停止，等 1h+ |

---

## 模块引用

- **配置文件**：`lib/config.js` — 公司ID映射、搜索策略、错误码定义
- **话术模板**：`lib/connect-templates.json` — 发送人信息、话术类型模板、个性化规则、报酬区间
- **API 封装**：`lib/voyager.js` — 搜索、Profile、Connect 脚本模板
- **安装脚本**：`scripts/install-opencli.sh` — opencli 一键安装
- **更新检查**：`scripts/check-update.sh` — opencli 版本检查

---

## 最终输出

1. 更新后的 Excel 文件路径
2. 摘要：

```
LinkedIn 寻访完成：
- 搜索：N 人
- Profile 获取：M 人
- 符合筛选：P 人
- 用户确认发送：Q 人
- 成功：R 人 / 失败：S 人
- 文件：~/Downloads/linkedin_search_YYYYMMDD_HHMMSS.xlsx
```
