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
 * @param {number} start - 起始位置
 * @param {string} keywords - 搜索关键词
 * @param {string} companyFilter - 公司过滤参数
 * @returns {string} 可执行的 JS 脚本
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
    educations: educations.map(x => ({school: x.schoolName, degree: x.degreeName, field: x.fieldOfStudy})),
    skills: skills.slice(0,10).map(x => x.name),
  });
})()
`;
}

/**
 * 发送 Connect - 返回 eval 脚本
 * @param {string} profileUrn - Profile URN
 * @param {string} note - 自定义消息
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
 * @param {string} companyName - 公司名称
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
 * 解析 Connect 结果
 * @param {object} result - API 返回结果
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
