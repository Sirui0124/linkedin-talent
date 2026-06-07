/**
 * LinkedIn Talent Search Configuration
 * 公司ID映射、搜索策略、筛选规则
 */

export const COMPANY_ID_MAP = {
  // 中国互联网
  'Alibaba': 1538,
  '阿里巴巴': 1538,
  'Tencent': 5765,
  '腾讯': 5765,
  'ByteDance': 15525013,
  '字节跳动': 15525013,
  'Baidu': 7555,
  '百度': 7555,
  'NetEase': 5116,
  '网易': 5116,
  'Huawei': 1344,
  '华为': 1344,
  'JD': 10683,
  '京东': 10683,
  'Meituan': 1064966,
  '美团': 1064966,
  'Xiaomi': 5765994,
  '小米': 5765994,
  'Pinduoduo': 18731298,
  '拼多多': 18731298,
  'Kuaishou': 11366628,
  '快手': 11366628,
  'Bilibili': 5765440,
  'B站': 5765440,

  // 咨询
  'McKinsey': 1371,
  '麦肯锡': 1371,
  'BCG': 3930,
  '波士顿咨询': 3930,
  'Bain': 2982,
  '贝恩': 2982,

  // 金融
  'Goldman Sachs': 1382,
  '高盛': 1382,

  // 科技
  'Microsoft': 1035,
  '微软': 1035,
  'Google': 1441,
  '谷歌': 1441,
  'Meta': 10667,
  'Apple': 162479,
  '苹果': 162479,
  'Amazon': 1586,
  '亚马逊': 1586,
  'Intel': 1053,
  '英特尔': 1053,
  'NVIDIA': 3608,
  '英伟达': 3608,
  'TSMC': 8869,
  '台积电': 8869,
  'Samsung': 1753,
  '三星': 1753,
  'Qualcomm': 2330,
  '高通': 2330,
  'AMD': 5283,
  'ASML': 1887,
};

/**
 * 搜索策略类型
 */
export const SEARCH_STRATEGIES = {
  CURRENT_COMPANY: 'currentCompany',   // 当前公司
  PAST_COMPANY: 'pastCompany',         // 前公司（已离职）
  KEYWORD_ONLY: 'keyword',             // 纯关键词
};

/**
 * 构建搜索过滤参数
 * @param {string} strategy - 搜索策略
 * @param {number[]} companyIds - 公司ID列表
 * @returns {string} 过滤参数字符串
 */
export function buildCompanyFilter(strategy, companyIds) {
  if (strategy === SEARCH_STRATEGIES.KEYWORD_ONLY || !companyIds?.length) {
    return '';
  }
  const ids = companyIds.join(',');
  return `(key:${strategy},value:List(${ids})),`;
}

/**
 * 获取公司ID（支持名称查找）
 * @param {string} companyName - 公司名称
 * @returns {number|null} 公司ID
 */
export function getCompanyId(companyName) {
  if (!companyName) return null;
  if (COMPANY_ID_MAP[companyName]) return COMPANY_ID_MAP[companyName];
  const normalized = String(companyName).toLowerCase();
  const match = Object.entries(COMPANY_ID_MAP)
    .find(([name]) => name.toLowerCase() === normalized);
  return match ? match[1] : null;
}

/**
 * 搜索配置默认值
 */
export const DEFAULT_SEARCH_CONFIG = {
  pageSize: 20,           // 每页结果数
  maxResults: 100,        // 默认最大结果数
  premiumMaxResults: 1000, // Premium 账号上限
  pageDelay: [3000, 5000], // 翻页间隔范围 (ms)
  profileDelay: [3000, 5000], // Profile 请求间隔
  connectDelay: [6000, 10000], // Connect 请求间隔
};

/**
 * 错误码定义
 */
export const ERROR_CODES = {
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  CANT_RESEND: 'CANT_RESEND_YET',
  WEEKLY_LIMIT: 'WEEKLY_INVITATION_LIMIT_EXCEEDED',
};

/**
 * 连接状态
 */
export const CONNECT_STATUS = {
  PENDING: '待确认',
  SENT: '已发送',
  CONNECTED: '已连接',
  FAILED: '失败',
  CANT_RESEND: 'CANT_RESEND',
};

/**
 * Tier 分档规则（用于 Phase 2 多公司+优先级搜索）
 *
 * tier1: 目标公司现任 + 近 6 个月内离职
 *   - 命中 currentCompany 搜索 → 直接 tier1
 *   - 命中 pastCompany 搜索且 Profile 中最后一段相关职位 endYear 与本年差 ≤ 1 → tier1
 *
 * tier2: 目标公司 6 个月以上离职
 *   - 命中 pastCompany 搜索且 endYear 与本年差 > 1 → tier2
 *
 * tier3: 其他公司但有相关关键词背景
 *   - 仅命中 keyword（无目标公司过滤）→ tier3
 *
 * 跨档命中：取最高 tier（数字最小）
 */
export const TIER_RULES = {
  TIER1: 1,
  TIER2: 2,
  TIER3: 3,
  RECENT_DEPARTURE_YEARS: 1,
};

/**
 * 候选人 tier 推荐度映射
 */
export function tierToStars(tier) {
  return tier === 1 ? '⭐⭐⭐' : tier === 2 ? '⭐⭐' : '⭐';
}

/**
 * 根据搜索策略 + Profile endYear 计算 tier
 */
export function computeTier(hitStrategy, latestRelevantEndYear, hitTargetCompany) {
  if (!hitTargetCompany) return TIER_RULES.TIER3;
  if (hitStrategy === 'currentCompany') return TIER_RULES.TIER1;
  if (latestRelevantEndYear == null) return TIER_RULES.TIER1;
  const currentYear = new Date().getFullYear();
  const yearsSinceLeft = currentYear - latestRelevantEndYear;
  return yearsSinceLeft <= TIER_RULES.RECENT_DEPARTURE_YEARS
    ? TIER_RULES.TIER1
    : TIER_RULES.TIER2;
}
