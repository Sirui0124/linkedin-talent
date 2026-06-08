# LinkedIn Talent Scout

**完整的 LinkedIn 人才寻访与建联工具**

通过 Claude Code 技能系统，实现从搜索候选人到批量发送连接请求的全自动化流程。

## 🚀 快速开始

### 1. 一键安装
```bash
# 克隆技能包到 Claude Code
git clone https://github.com/Sirui0124/linkedin-talent.git ~/.claude/skills/linkedin-talent

# 自动安装所有依赖（支持 Windows/macOS/Linux）
bash ~/.claude/skills/linkedin-talent/scripts/install-complete.sh
```

### 2. 安装 Chrome 扩展
- 在 Chrome Web Store 搜索 **"opencli browser bridge"**
- 点击「添加至 Chrome」

### 3. 验证安装
```bash
bash ~/.claude/skills/linkedin-talent/scripts/doctor.sh
```

### 4. 开始使用
在 Claude Code 中输入：
```
/linkedin-talent
```

## 💡 主要功能

### 智能寻访策略
- **核心搜索词**：用少量高信号关键词精准召回，减少噪声
- **基础筛选**：按公司、经历、关键词排除明显不匹配的人
- **AI 评分**：结合 Profile 证据多维度排序，输出 Tier 分层

### 完整寻访流程
1. **环境检查** - 自动验证工具链完整性
2. **需求解析** - 拆成搜索入口、筛选条件和排序口径
3. **搜索召回** - LinkedIn API 精准召回候选人
4. **AI 评分** - 多维度评分并分层
5. **Excel 导出** - 结构化候选人数据
6. **Review 确认** - 可视化审核界面
7. **批量建联** - 自动发送个性化连接请求
8. **数据同步** - 更新主数据仪表板

## 🔧 技术特性

- **跨平台兼容**：Windows (Git Bash)、macOS、Linux
- **智能安装**：一键脚本自动处理依赖和配置
- **安全控制**：内置频率限制和错误处理
- **可扩展性**：模块化设计，易于定制和扩展

## 📋 系统要求

- **Node.js** >= 18
- **Chrome** 浏览器 + opencli 扩展
- **LinkedIn** 账户（已登录）
- **剪贴板工具**（系统自带或 xclip/wl-clipboard）

## 📖 文档

- [完整安装指南](INSTALL_COMPLETE.md) - 详细的跨平台安装步骤
- [技能说明](SKILL.md) - 技能架构和使用流程
- [故障排除](INSTALL.md) - 常见问题解决方案

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个工具。

## 📜 许可证

MIT License
