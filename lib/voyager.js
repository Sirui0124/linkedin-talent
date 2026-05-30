/**
 * LinkedIn Voyager API 调用模块
 * 封装搜索、Profile、Connect 等 API
 */

import { buildCompanyFilter, DEFAULT_SEARCH_CONFIG, ERROR_CODES } from './config.js';

/**
 * 获取 CSRF Token
 */
export function getCsrfToken() {
  return `document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || ''`;
}

/**
 * 构建搜索 API URL
 */
export function buildSearchUrl(start, keywords, companyFilter) {
  const baseUrl = 'https://www.linkedin.com/voyager/api/graphql';
  const queryId = 'voyagerSearchDashClusters.66adc6056cf4138949ca5dcb31bb1749';
  const variables = `(start:${start},count:20,origin:FACETED_SEARCH,query:(keywords:${encodeURIComponent(keywords)},flagshipSearchIntent:SEARCH_SRP,queryParameters:List(${companyFilter}(key:resultType,value:List(PEOPLE)))))`;
  return `${baseUrl}?variables=${variables}&queryId=${queryId}`;
}

/**
 * 搜索候选人 - 返回 eval 脚本
 *
 * 通过浏览器 cookie 注入 CSRF token 调用 LinkedIn Voyager GraphQL。
 * 由 Phase 2 编排逐 (keyword × company × strategy × page) 调用，每页间隔 3-5s（参 lib/safety.json）。
 *
 * companyFilter 取值（由 lib/config.js 的 buildCompanyFilter 生成）：
 *   - 当前公司:  "(key:currentCompany,value:List(<id>)),"
 *   - 前公司:    "(key:pastCompany,value:List(<id>)),"
 *   - 纯关键词:   ""（空字符串）
 *
 * ⚠️ CSRF 正则关键：opencli browser eval 中双引号需用 \\\" 转义；
 *    若手写脚本，正则模式必须为 /JSESSIONID=\\\"?([^;\\\"]+)/。
 *
 * 错误码：401/403/429 → 整个 Phase 2 立即停止（用 parseSearchError 判断）。
 *
 * @param {number} start - 起始位置（page * 20）
 * @param {string} keywords - 搜索关键词
 * @param {string} companyFilter - 公司过滤参数
 * @returns {string} 可执行的 JS 脚本（喂给 opencli browser linkedin eval）
 */
export function searchCandidatesScript(start, keywords, companyFilter) {
  return `
(async () => {
  const csrf = document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || '';
  const start = ${start};
  const count = 20;
  const keywords = '${keywords.replace(/'/g, "\\'")}';
  const companyFilter = '${companyFilter}';
  const url = 'https://www.linkedin.com/voyager/api/graphql?variables=(start:' + start + ',count:' + count + ',origin:FACETED_SEARCH,query:(keywords:' + encodeURIComponent(keywords) + ',flagshipSearchIntent:SEARCH_SRP,queryParameters:List(' + companyFilter + '(key:resultType,value:List(PEOPLE)))))&queryId=voyagerSearchDashClusters.66adc6056cf4138949ca5dcb31bb1749';
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1', 'csrf-token': csrf },
    credentials: 'include',
  });
  if (!resp.ok) return JSON.stringify({error: resp.status});
  const data = await resp.json();
  const items = (data.included || []).filter(i => i.navigationUrl && i.navigationUrl.includes('/in/'));
  return JSON.stringify({
    total: data.data?.paging?.total || items.length,
    results: items.map(i => ({
      name: i.title?.text || '',
      headline: i.primarySubtitle?.text || '',
      location: i.secondarySubtitle?.text || '',
      profile_url: i.navigationUrl,
      vanity: (i.navigationUrl || '').match(/\\/in\\/([^/?]+)/)?.[1] || '',
      urn: (i.entityUrn || i.targetUrn || '').match(/(urn:li:fsd_profile:[^,)]+)/)?.[0] || '',
      connectionDegree: i.entityCustomTrackingInfo?.memberDistance || i.badgeText?.text || '',
    }))
  });
})()
`;
}

/**
 * 获取 Profile 详情 - 返回 eval 脚本
 * @param {string} vanity - 用户 vanity
 * @returns {string} 可执行的 JS 脚本
 */
export function getProfileScript(vanity) {
  return `
(async () => {
  const csrf = document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || '';
  const vanity = '${vanity}';
  const resp = await fetch('https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + vanity + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93', {
    headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1', 'x-restli-protocol-version': '2.0.0', 'csrf-token': csrf },
    credentials: 'include',
  });
  const data = await resp.json();
  const inc = data.included || [];
  const p = inc.find(i => (i.entityUrn||'').includes('fsd_profile') && i.firstName) || {};
  const positions = inc.filter(i => (i['\\$type']||'').includes('Position') && i.title);
  const educations = inc.filter(i => (i['\\$type']||'').includes('Education') && i.schoolName);
  const skills = inc.filter(i => (i['\\$type']||'').includes('Skill') && i.name);
  return JSON.stringify({
    urn: p.entityUrn || '',
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    headline: p.headline || '',
    summary: (p.summary || '').slice(0, 500),
    location: p.geoLocationName || '',
    positions: positions.map(x => ({title: x.title, company: x.companyName, startYear: x.dateRange?.start?.year, endYear: x.dateRange?.end?.year, desc: (x.description||'').slice(0,150)})),
    educations: educations.map(x => ({school: x.schoolName, degree: x.degreeName, field: x.fieldOfStudy, startYear: x.dateRange?.start?.year, endYear: x.dateRange?.end?.year})),
    skills: skills.slice(0,10).map(x => x.name),
  });
})()
`;
}

/**
 * 发送 Connect - 返回 eval 脚本（Phase 6 入口）
 *
 * ── 调用契约 ──────────────────────────────────────────────────────────────
 *   1. 前提：phase4 已生成 Excel 与 Review HTML，phase5 已收到用户决策 JSON
 *   2. 跳过 connect_status === "skip" 的候选人
 *   3. 逐个发送，每次间隔由 lib/safety.json 的 intervals.connect 控制（6-10s 随机）
 *   4. 调用方式：opencli browser linkedin eval "<sendConnectScript 输出的脚本>"
 *
 * ── 结果处理（用 parseConnectResult 解析）─────────────────────────────────
 *   | API 返回                                  | Excel S 列    | 后续动作            |
 *   |-------------------------------------------|---------------|--------------------|
 *   | 200 + invitationUrn                        | 已发送        | 继续下一个          |
 *   | 400 CANT_RESEND_YET                        | CANT_RESEND   | 跳过这一个          |
 *   | 400 WEEKLY_INVITATION_LIMIT_EXCEEDED       | 失败           | **整个 Phase 6 停止** |
 *   | 401 / 403 / 429                            | 失败           | **整个 Phase 6 停止** |
 *   | 其他                                       | 失败           | 跳过这一个          |
 *
 * 每发完一个立即把状态写回 Excel S 列（保持断电可续）。
 *
 * ── 最终输出格式（Phase 6 完成后报告）─────────────────────────────────────
 *   LinkedIn 寻访完成（batch_id: search_YYYYMMDD_HHMM[_LABEL]）：
 *   - 搜索：N 人（共 K 次 API 调用）
 *   - Profile 获取：M 人
 *   - 筛选通过：P 人（Tier1: a / Tier2: b / Tier3: c）
 *   - 用户确认发送：Q 人
 *   - 成功：R / CANT_RESEND：S / 失败：T
 *   - 当批次 Excel：~/.linkedin-talent/batches/linkedin_<batch_id>.xlsx
 *   - Master Dashboard：~/.linkedin-talent/dashboard.xlsx（Phase 7 同步后）
 *
 * @param {string} profileUrn - Profile URN（如 urn:li:fsd_profile:ACoAA...）
 * @param {string} note       - 用户确认过的话术（≤ 290 字符；超出会被 LinkedIn 拒收）
 * @returns {string} 可执行的 JS 脚本
 */
export function sendConnectScript(profileUrn, note) {
  const escapedNote = note.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `
(async () => {
  const csrf = document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || '';
  const profileUrn = '${profileUrn}';
  const note = "${escapedNote}";
  const resp = await fetch('https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreate', {
    method: 'POST',
    headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1', 'Content-Type': 'application/json', 'x-restli-protocol-version': '2.0.0', 'csrf-token': csrf },
    credentials: 'include',
    body: JSON.stringify({ inviteeProfileUrn: profileUrn, customMessage: note }),
  });
  const body = await resp.text();
  return JSON.stringify({status: resp.status, body: body.slice(0, 300)});
})()
`;
}

/**
 * 查找公司 ID - 返回 eval 脚本
 *
 * 用于 lib/config.js 的 COMPANY_ID_MAP 中没有的公司。流程：
 *   1. 调 typeahead API 取前 5 个 fsd_company 候选
 *   2. typeahead 偶发 500 → fallback：让用户在 LinkedIn 网页搜公司，从 URL 提取 ID
 *   3. 找到的 ID 添加到 COMPANY_ID_MAP，避免重复查询
 *
 * @param {string} companyName - 公司名称（建议英文，typeahead 对英文更准）
 * @returns {string} 可执行的 JS 脚本
 */
export function findCompanyIdScript(companyName) {
  return `
(async () => {
  const csrf = document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || '';
  const resp = await fetch('https://www.linkedin.com/voyager/api/graphql?variables=(query:COMPANY_NAME,types:List(COMPANY),count:5)&queryId=voyagerSearchDashReusableTypeahead.57a4fa1d8a1d8c5ac48d73e28f24a94a', {
    headers: { 'Accept': 'application/vnd.linkedin.normalized+json+2.1', 'csrf-token': csrf },
    credentials: 'include',
  });
  const data = await resp.json();
  const companies = (data.included || []).filter(i => (i.entityUrn || '').includes('fsd_company'));
  return JSON.stringify(companies.map(c => ({id: c.entityUrn?.match(/\\d+/)?.[0], name: c.name})));
})()
`;
}

/**
 * 解析搜索结果错误
 * @param {object} result - API 返回结果
 * @returns {{shouldStop: boolean, reason: string}}
 */
export function parseSearchError(result) {
  if (result.error === ERROR_CODES.SESSION_EXPIRED) {
    return { shouldStop: true, reason: 'Session 失效，请重新登录 LinkedIn' };
  }
  if (result.error === ERROR_CODES.FORBIDDEN) {
    return { shouldStop: true, reason: '被限制访问，请稍后重试' };
  }
  if (result.error === ERROR_CODES.RATE_LIMITED) {
    return { shouldStop: true, reason: '频率限制，请等待 1 小时后重试' };
  }
  return { shouldStop: false, reason: '' };
}

/**
 * 解析 Connect 结果（Phase 6 用）
 *
 * 错误码完整定义见 lib/safety.json 的 error_codes / stop_on_status。
 * 调用方应根据返回的 status 决定：
 *   - status==="已发送"        → 写 Excel S 列，继续
 *   - status==="CANT_RESEND"  → 写 Excel S 列，跳过这一个
 *   - status==="周上限"        → 写 Excel S 列，**整批停止**
 *   - status==="需要停止"       → 写 Excel S 列，**整批停止**（401/403/429）
 *   - status==="失败"          → 写 Excel S 列，跳过这一个
 *
 * @param {object} result - sendConnectScript 返回的 {status, body}
 * @returns {{success: boolean, status: string}}
 */
export function parseConnectResult(result) {
  const { status, body } = result;

  if (status === 200 && body.includes('invitationUrn')) {
    return { success: true, status: '已发送' };
  }
  if (status === 400 && body.includes(ERROR_CODES.CANT_RESEND)) {
    return { success: false, status: 'CANT_RESEND' };
  }
  if (status === 400 && body.includes(ERROR_CODES.WEEKLY_LIMIT)) {
    return { success: false, status: '周上限' };
  }
  if (status === 401 || status === 403 || status === 429) {
    return { success: false, status: '需要停止' };
  }
  return { success: false, status: '失败' };
}
