#!/usr/bin/env node
/**
 * Phase 3: Profile fetch → L2 hard filter → L2.5 rule score → L3 LLM score
 *
 * Usage:
 *   node phase3-profile-score.mjs --batch-id <id>
 *     # 自动按 lib/paths.js 解析输入输出路径
 *
 *   或显式指定（高级用法）:
 *   node phase3-profile-score.mjs \
 *     --input    data/exports/raw_<id>.json \
 *     --criteria data/criteria/<id>.json \
 *     [--output  data/exports/phase3_<id>.json] \
 *     [--resume  <phase3-partial.json>]
 *
 * Output: { summary, passed, failed }
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import {
  rawCandidatesPath, criteriaPath, phase3JsonPath,
  phase3SubagentInputPath, phase3SubagentScoresPath,
  ensureDataDirs,
} from '../lib/paths.js';
import { isValidBatchId, parseBatchId } from '../lib/naming.js';

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    batchId: null, input: null, criteria: null, output: null, resume: null,
    useLlm: process.env.LINKEDIN_TALENT_LLM !== '0',
    llmOnly: false,
    rescoreOnly: false,
    selfTest: false,
    scores: null,
    forceSubagent: false,
    subagentThreshold: Number(process.env.LINKEDIN_TALENT_SUBAGENT_THRESHOLD || 50),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id') opts.batchId  = args[++i];
    if (args[i] === '--input')    opts.input    = resolve(args[++i]);
    if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    if (args[i] === '--output')   opts.output   = resolve(args[++i]);
    if (args[i] === '--resume')   opts.resume   = resolve(args[++i]);
    if (args[i] === '--no-llm')   opts.useLlm = false;
    if (args[i] === '--llm-only') opts.llmOnly = true;
    if (args[i] === '--rescore-only') opts.rescoreOnly = true;
    if (args[i] === '--self-test') opts.selfTest = true;
    if (args[i] === '--scores')   opts.scores   = resolve(args[++i]);
    if (args[i] === '--force-subagent') opts.forceSubagent = true;
  }
  if (opts.selfTest) return opts;
  // 通过 batch-id 自动展开
  if (opts.batchId) {
    if (!isValidBatchId(opts.batchId)) {
      console.error(`[error] 非法 batch-id: ${opts.batchId}（格式: search_YYYYMMDD_HHMM[_LABEL]）`);
      process.exit(1);
    }
    opts.input    ??= rawCandidatesPath(opts.batchId);
    opts.criteria ??= criteriaPath(opts.batchId);
    opts.output   ??= phase3JsonPath(opts.batchId);
  }
  if (!opts.input || !opts.criteria) {
    console.error('Usage: node phase3-profile-score.mjs --batch-id <id>');
    console.error('   or: node phase3-profile-score.mjs --input <raw.json> --criteria <criteria.json> [--output <out.json>] [--resume <partial.json>]');
    process.exit(1);
  }
  if (!opts.output) {
    console.error('[error] --output 缺失，且未提供 --batch-id 来推断');
    process.exit(1);
  }
  opts.batchId ??= parseBatchId(opts.output) || parseBatchId(opts.input) || null;
  ensureDataDirs();
  return opts;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randInt(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }

/**
 * 人类化停顿：非均匀分布，偶发长停顿，避免规律性风控检测
 * - 70% 概率：短停（3-5s，带 ±0.5s 微抖动）
 * - 20% 概率：中停（6-9s，模拟"看了一会儿"）
 * - 7%  概率：长停（12-20s，模拟切换标签/分神）
 * - 3%  概率：超长停（25-45s，模拟接了个消息）
 */
async function humanDelay(counter) {
  const r = Math.random();
  let base;
  if (r < 0.70)      base = randInt(3000, 5000);
  else if (r < 0.90) base = randInt(6000, 9000);
  else if (r < 0.97) base = randInt(12000, 20000);
  else               base = randInt(25000, 45000);

  // 微抖动：±10% 使同一档位内也不规律
  const jitter = Math.floor(base * (Math.random() * 0.2 - 0.1));
  const total = base + jitter;

  // 每 ~15 人额外插入一次"浏览停顿"（模拟翻页/回滚行为）
  const extraPause = (counter > 0 && counter % randInt(13, 17) === 0)
    ? randInt(8000, 15000) : 0;

  await sleep(total + extraPause);
}

function opencliEval(script) {
  const result = execFileSync('opencli', ['browser', 'linkedin', 'eval', script], {
    timeout: 30_000, encoding: 'utf8',
  });
  // opencli wraps result in quotes sometimes — strip
  const clean = result.trim().replace(/^"|"$/g, '');
  return JSON.parse(clean);
}

// ── Pre-filter (no API, uses search-card headline + hits) ─────────────────────
function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getSearchKeywordStages(criteria) {
  const sk = criteria.search_keywords || {};
  const legacy = criteria.search || {};
  return {
    primary: asArray(sk.primary).concat(asArray(legacy.primary), asArray(legacy.primary_keywords)),
    secondary: asArray(sk.secondary).concat(asArray(legacy.secondary), asArray(legacy.secondary_keywords)),
    fallback: asArray(sk.fallback).concat(asArray(legacy.fallback), asArray(legacy.fallback_keywords)),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map(v => String(v).trim()).filter(Boolean))];
}

function includesAny(text, kws) {
  const haystack = String(text || '').toLowerCase();
  return kws.some(kw => haystack.includes(String(kw).toLowerCase()));
}

function preFilter(candidate, criteria) {
  const filters = criteria.hard_filters || {};
  const pre = criteria.prefilter || criteria.pre_filter || {};
  const keywordStages = getSearchKeywordStages(criteria);
  const searchKws = uniqueStrings([
    ...keywordStages.primary,
    ...keywordStages.secondary,
    ...keywordStages.fallback,
  ]);
  const titleKws = uniqueStrings([
    ...asArray(pre.title_match_any),
    ...asArray(pre.title_must_match_any),
    ...asArray(filters.prefilter_title_match_any),
    ...asArray(filters.title_must_match_any),
  ]);
  const mustNotKws = uniqueStrings([
    ...asArray(pre.must_not_have_any_kw),
    ...asArray(filters.must_not_have_any_kw),
  ]);
  const headline = candidate.headline || '';
  const hitText = (candidate.hits || []).map(h => [h.kw, h.company, h.strategy].filter(Boolean).join(' ')).join(' ');
  const text = [candidate.name, headline, candidate.location, hitText].filter(Boolean).join(' ');

  if (mustNotKws.length && includesAny(text, mustNotKws)) return false;
  if (titleKws.length) {
    if (!headline.trim()) return true;
    if (includesAny(headline, titleKws)) return true;
    const targetCompanyKeywordHit = (candidate.hits || []).some(h =>
      h.hitTargetCompany && searchKws.some(kw => String(kw).toLowerCase() === String(h.kw || '').toLowerCase())
    );
    return Boolean(pre.keep_target_company_keyword_hit ?? true) && targetCompanyKeywordHit;
  }
  if (searchKws.length) return includesAny(text, searchKws);
  return true;
}

// ── L2 Hard filter ────────────────────────────────────────────────────────────
function buildProfileText(profile) {
  const posText = (profile.positions || [])
    .map(p => `${p.company || ''} ${p.title || ''} ${p.desc || ''}`)
    .join(' ');
  return [profile.headline, profile.search_card_headline, profile.summary, posText, (profile.skills || []).join(' ')].join(' ');
}

function fuzzyMatch(target, actual) {
  if (!target || !actual) return false;
  const t = target.toLowerCase(), a = actual.toLowerCase();
  return a.includes(t) || t.includes(a);
}

function matchesAnyCompany(company, targetCos) {
  return targetCos.some(c => {
    const name = typeof c === 'string' ? c : c?.name;
    return fuzzyMatch(name, company || '');
  });
}

function targetCompaniesForScoring(criteria) {
  return uniqueStrings([
    ...asArray(criteria.hard_filters?.any_of_companies).map(c => typeof c === 'string' ? c : c?.name),
    ...asArray(criteria.target_companies).map(c => typeof c === 'string' ? c : c?.name),
  ]);
}

function targetCompanyPositions(profile, criteria) {
  const positions = profile.positions || [];
  const targetCos = targetCompaniesForScoring(criteria);
  if (!targetCos.length) return [];
  return positions.filter(p => matchesAnyCompany(p.company, targetCos));
}

function findTargetPosition(profile, criteria) {
  const titleKws = criteria.hard_filters?.title_must_match_any || [];
  const currentYear = new Date().getFullYear();

  const targetPositions = targetCompanyPositions(profile, criteria);
  const roleMatches = targetPositions.filter(p =>
    !titleKws.length || titleKws.some(kw => fuzzyMatch(kw, p.title || ''))
  );
  const pool = roleMatches.length ? roleMatches : targetPositions;
  if (!pool.length) return null;

  return pool
    .slice()
    .sort((a, b) => {
      const aActive = !a.endYear || a.endYear >= currentYear;
      const bActive = !b.endYear || b.endYear >= currentYear;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (b.startYear || 0) - (a.startYear || 0);
    })[0];
}

function findTargetRolePositions(profile, criteria) {
  const titleKws = criteria.hard_filters?.title_must_match_any || [];

  const targetPositions = targetCompanyPositions(profile, criteria);
  const roleMatches = targetPositions.filter(p =>
    !titleKws.length || titleKws.some(kw => fuzzyMatch(kw, p.title || ''))
  );
  return roleMatches.length ? roleMatches : targetPositions;
}

function targetCompanyEmploymentWindow(profile, criteria) {
  const currentYear = new Date().getFullYear();
  const positions = targetCompanyPositions(profile, criteria);
  if (!positions.length) {
    return { positions: [], years: 0, current: false, startYear: null, endYear: null, hasUnknownStart: false };
  }

  let hasUnknownStart = false;
  const intervals = [];
  for (const p of positions) {
    if (!p.startYear) {
      hasUnknownStart = true;
      continue;
    }
    intervals.push({
      start: Number(p.startYear),
      end: Number(p.endYear || currentYear),
      current: !p.endYear || Number(p.endYear) >= currentYear,
    });
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
    last.current = last.current || interval.current;
  }

  return {
    positions,
    years: merged.reduce((sum, i) => sum + Math.max(0, i.end - i.start), 0),
    current: intervals.some(i => i.current) || (hasUnknownStart && positions.some(p => !p.endYear)),
    startYear: intervals.length ? Math.min(...intervals.map(i => i.start)) : null,
    endYear: intervals.some(i => i.current) ? null : Math.max(...intervals.map(i => i.end)),
    hasUnknownStart,
  };
}

function targetRoleDuration(profile, criteria) {
  return targetCompanyEmploymentWindow(profile, criteria);
}

function targetRoleDurationScore(profile, criteria) {
  const { years, hasUnknownStart } = targetRoleDuration(profile, criteria);
  if (years >= 5) return 100;
  if (years >= 3) return 85;
  if (years >= 2) return 70;
  if (years >= 1) return 45;
  if (years > 0) return 25;
  return hasUnknownStart ? 40 : 0;
}

function getTargetEmploymentPolicy(filtersOrCriteria) {
  const filters = filtersOrCriteria?.hard_filters || filtersOrCriteria || {};
  return filters.target_employment || filters.employment_recency || filtersOrCriteria?.target_employment || {};
}

function targetEmploymentStatus(profile, criteria) {
  const currentYear = new Date().getFullYear();
  const employmentWindow = targetCompanyEmploymentWindow(profile, criteria);
  if (!employmentWindow.positions.length) {
    return { status: 'unknown', label: '目标公司在职状态未知', yearsSinceLeft: null, position: null };
  }
  const targetPosition = findTargetPosition(profile, criteria) || employmentWindow.positions[0];

  if (employmentWindow.current) {
    return { status: 'current', label: '目标公司现任/在职', yearsSinceLeft: 0, position: targetPosition };
  }

  const yearsSinceLeft = Math.max(0, currentYear - Number(employmentWindow.endYear || currentYear));
  return {
    status: yearsSinceLeft <= 1 ? 'departed_recent' : 'departed_past',
    label: yearsSinceLeft <= 1 ? '目标公司近期离职' : `目标公司离职约 ${yearsSinceLeft} 年`,
    yearsSinceLeft,
    position: targetPosition,
  };
}

function normalizedEmploymentAccepted(policy) {
  return asArray(policy.accepted_statuses || policy.accepted || policy.statuses)
    .map(s => String(s).toLowerCase());
}

function employmentStatusAccepted(employment, policy) {
  const accepted = normalizedEmploymentAccepted(policy);
  const mode = String(policy.mode || policy.requirement || '').toLowerCase();
  const maxYears = Number(policy.max_years_since_left ?? policy.maxYearsSinceLeft);
  const minYears = Number(policy.min_years_since_left ?? policy.minYearsSinceLeft);

  if (!policy || (!accepted.length && !mode && !policy.require_current && !policy.require_departed && !Number.isFinite(maxYears) && !Number.isFinite(minYears))) {
    return { pass: true, reason: '' };
  }
  if (employment.status === 'unknown') {
    return { pass: false, reason: '目标公司在职/离职状态未知' };
  }

  const isCurrent = employment.status === 'current';
  const isDeparted = employment.status === 'departed_recent' || employment.status === 'departed_past';

  if (policy.require_current || mode === 'current_only' || mode === 'current') {
    return isCurrent ? { pass: true, reason: '' } : { pass: false, reason: '不符合目标公司在职要求' };
  }
  if (policy.require_departed || mode === 'departed_only' || mode === 'former_only' || mode === 'past_only') {
    if (!isDeparted) return { pass: false, reason: '不符合目标公司离职/前任要求' };
  }

  if (accepted.length) {
    const wantsCurrent = accepted.some(s => /current|active|incumbent|现任|在职/.test(s));
    const wantsDeparted = accepted.some(s => /departed|former|past|left|alumni|离职|前任/.test(s));
    const acceptedByStatus =
      (isCurrent && wantsCurrent) ||
      (isDeparted && wantsDeparted) ||
      (employment.status === 'departed_recent' && accepted.some(s => /recent|within|近期|一年|1y|12/.test(s)));
    if (!acceptedByStatus) return { pass: false, reason: `不符合目标公司在职状态要求: ${employment.label}` };
  }

  if (isDeparted && Number.isFinite(maxYears) && employment.yearsSinceLeft > maxYears) {
    return { pass: false, reason: `目标公司离职超过 ${maxYears} 年` };
  }
  if (isDeparted && Number.isFinite(minYears) && employment.yearsSinceLeft < minYears) {
    return { pass: false, reason: `目标公司离职不足 ${minYears} 年` };
  }

  return { pass: true, reason: '' };
}

function employmentPolicyIsStrict(policy) {
  return policy.hard_filter === true ||
    policy.required === true ||
    policy.strict === true ||
    policy.source === 'user_explicit';
}

function employmentRecencyScore(profile, criteria) {
  const policy = getTargetEmploymentPolicy(criteria);
  const employment = targetEmploymentStatus(profile, criteria);
  const accepted = employmentStatusAccepted(employment, policy);
  const maxYears = Number(policy.max_years_since_left ?? policy.maxYearsSinceLeft);
  const minYears = Number(policy.min_years_since_left ?? policy.minYearsSinceLeft);
  const duration = targetRoleDuration(profile, criteria);

  if (employment.status === 'unknown') return 35;
  if (!accepted.pass) return 15;
  if (employment.status === 'current') {
    if (policy.require_departed || String(policy.mode || '').toLowerCase().includes('departed')) return 45;
    if (duration.years >= 3) return 100;
    if (duration.years >= 1) return 90;
    return duration.hasUnknownStart ? 80 : 75;
  }

  const years = employment.yearsSinceLeft ?? 99;
  if (Number.isFinite(maxYears) && years <= maxYears) return 95;
  if (Number.isFinite(minYears) && years >= minYears) return 90;
  if (years <= 1) return 85;
  if (years <= 2) return 60;
  if (years <= 3) return 40;
  return 20;
}

function employmentNote(profile, criteria) {
  const employment = targetEmploymentStatus(profile, criteria);
  return employment.label ? `；${employment.label}` : '';
}

function countHits(text, kws) {
  const haystack = String(text || '').toLowerCase();
  return uniqueStrings(kws).filter(kw => haystack.includes(String(kw).toLowerCase())).length;
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}

function scoreFromHits(hitCount, maxHits, base = 25, step = 18) {
  if (hitCount <= 0) return base;
  return clampScore(base + Math.min(hitCount, maxHits) * step);
}

function titleText(profile) {
  return (profile.positions || []).map(p => p.title || '').join(' ');
}

function currentPosition(profile) {
  return profile.positions?.[0] || {};
}

function isCurrentTargetPosition(profile, criteria) {
  return targetCompanyEmploymentWindow(profile, criteria).current;
}

function dimSemanticText(d) {
  return `${d.key || ''} ${d.label || ''} ${d.description || ''}`.toLowerCase();
}

function criteriaTopicText(criteria) {
  const sk = criteria.search_keywords || {};
  return [
    criteria.topic_specific,
    criteria.research_precheck?.research_context,
    ...(criteria.research_questions || []).map(q => q.ask),
    ...(criteria.scoring_dimensions || []).map(d => `${d.label || ''} ${d.description || ''}`),
    ...(criteria.hard_filters?.topic_groups || []).map(g => `${g.label || ''} ${asArray(g.any_kw).join(' ')}`),
    ...asArray(sk.primary),
    ...asArray(sk.secondary),
    ...asArray(sk.fallback),
    ...asArray(sk.company_topic_matrix).flatMap(row => asArray(row.queries)),
    ...asArray(criteria.must_answer_evidence),
  ].filter(Boolean).join(' ');
}

function productKeywords(criteria) {
  const topicGroups = criteria.hard_filters?.topic_groups || [];
  const productGroups = topicGroups.filter(g => /product|technology|technical|feature|ai|engineering|workload|coverage|adoption|产品|技术|课题|覆盖/i.test(`${g.label || ''}`));
  return uniqueStrings([
    ...productGroups.flatMap(g => asArray(g.any_kw)),
    ...genericDimensionKeywords({ key: 'topic', label: 'topic', description: criteriaTopicText(criteria) }, criteria),
  ]);
}

function commercialKeywords(criteria) {
  const topicGroups = criteria.hard_filters?.topic_groups || [];
  const commercialGroups = topicGroups.filter(g => /commercial|channel|consumption|gtm|sales|marketplace|partner/i.test(`${g.label || ''}`));
  return uniqueStrings([
    ...commercialGroups.flatMap(g => asArray(g.any_kw)),
    'partner', 'alliance', 'channel', 'sales', 'gtm', 'go-to-market',
    'marketplace', 'co-sell', 'business development', 'ecosystem',
    'customer success', 'practice', 'solution', 'solutions',
  ]);
}

function consumptionKeywords(criteria) {
  return uniqueStrings([
    ...asArray(criteria.must_answer_evidence),
    'consumption', 'usage', 'pipeline', 'growth', 'expansion', 'revenue',
    'capacity drawdown', 'drawdown', 'commit', 'marketplace', 'co-sell',
    'customer', 'customers', 'adoption', 'workload', 'workloads',
  ]);
}

function seniorityKeywords() {
  return [
    'vp', 'vice president', 'director', 'principal', 'partner', 'head',
    'lead', 'manager', 'senior', 'sr.', 'architect', 'solution architect',
    'practice lead', 'business development', 'gtm',
  ];
}

function genericDimensionKeywords(d, criteria) {
  const semantic = dimSemanticText(d);
  const words = semantic
    .split(/[^a-z0-9+#.]+/i)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !['whether', 'person', 'candidate', 'exposure', 'description', 'weight'].includes(w));
  const matchingGroups = (criteria.hard_filters?.topic_groups || []).filter(g =>
    countHits(`${g.label || ''} ${asArray(g.any_kw).join(' ')}`, words) > 0
  );
  return uniqueStrings([...words, ...matchingGroups.flatMap(g => asArray(g.any_kw))]);
}

function semanticDimensionScore(d, profile, criteria) {
  const semantic = dimSemanticText(d);
  const allText = buildProfileText(profile);
  const titles = titleText(profile);
  const targetPosition = findTargetPosition(profile, criteria);
  const currentTarget = isCurrentTargetPosition(profile, criteria);

  if (/channel|partner|alliance|gtm|marketplace|co-sell|commercial|sales|ecosystem/.test(semantic)) {
    const titleHits = countHits(titles, commercialKeywords(criteria));
    const textHits = countHits(allText, commercialKeywords(criteria));
    const hitHits = countHits(hitsSummary(profile.hits), commercialKeywords(criteria));
    return clampScore(20 + Math.min(titleHits, 3) * 18 + Math.min(textHits, 4) * 9 + Math.min(hitHits, 2) * 8 + (currentTarget ? 10 : 0));
  }

  if (/consumption|usage|pipeline|growth|drawdown|revenue|workload|expansion/.test(semantic)) {
    const explicitHits = countHits(allText, consumptionKeywords(criteria));
    const commercialHits = countHits(allText, commercialKeywords(criteria));
    const titleHits = countHits(titles, ['sales', 'gtm', 'marketplace', 'partner', 'alliance', 'customer success', 'business development']);
    return clampScore(15 + Math.min(explicitHits, 4) * 16 + Math.min(commercialHits, 3) * 8 + Math.min(titleHits, 2) * 10);
  }

  if (/product|technology|technical|feature|ai|coverage|adoption|产品|技术|课题|覆盖/.test(semantic)) {
    const explicitHits = countHits(allText, productKeywords(criteria));
    const titleHits = countHits(titles, productKeywords(criteria));
    return scoreFromHits(explicitHits + titleHits, 5, 20, 14);
  }

  if (/employment|recency|fresh|current|recent|depart|former|离职|在职|现任|当前性|新鲜/.test(semantic)) {
    return employmentRecencyScore(profile, criteria);
  }

  if (/seniority|senior|资历/.test(semantic)) {
    const seniorityHits = countHits(titles, seniorityKeywords());
    const duration = targetRoleDurationScore(profile, criteria);
    return clampScore(Math.max(duration, 25) + Math.min(seniorityHits, 4) * 10 + (currentTarget || !targetPosition?.endYear ? 10 : 0));
  }

  const genericHits = countHits(allText, genericDimensionKeywords(d, criteria));
  return scoreFromHits(genericHits, 4, 30, 12);
}

function hardFilter(profile, criteriaOrFilters) {
  const criteria = criteriaOrFilters?.hard_filters ? criteriaOrFilters : { hard_filters: criteriaOrFilters || {} };
  const filters = criteria.hard_filters || {};
  // 公司匹配（宽松：只要任一职位含目标公司即通过）
  if (filters.any_of_companies?.length) {
    const allCos = (profile.positions || []).map(p => p.company || '');
    const hit = allCos.some(co => matchesAnyCompany(co, filters.any_of_companies));
    if (!hit) return { pass: false, reason: '无任何目标公司经历' };
  }
  // 必含关键词（至少命中 1 个）
  if (filters.must_have_any_kw?.length) {
    const text = buildProfileText(profile).toLowerCase();
    const hit = filters.must_have_any_kw.some(kw => text.includes(kw.toLowerCase()));
    if (!hit) return { pass: false, reason: '完全无相关关键词' };
  }
  // 排除词（严格）
  if (filters.must_not_have_any_kw?.length) {
    const text = buildProfileText(profile).toLowerCase();
    for (const kw of filters.must_not_have_any_kw) {
      if (text.includes(kw.toLowerCase())) return { pass: false, reason: `命中排除词: ${kw}` };
    }
  }
  // Title 模糊匹配（放宽：全部 title 文本包含任一关键词即可）
  if (filters.title_must_match_any?.length) {
    const allTitles = (profile.positions || []).map(p => p.title || '').join(' ').toLowerCase();
    const hit = filters.title_must_match_any.some(kw => allTitles.includes(kw.toLowerCase()));
    if (!hit) return { pass: false, reason: 'Title 无相关关键词' };
  }
  const employmentPolicy = getTargetEmploymentPolicy(filters);
  if (employmentPolicyIsStrict(employmentPolicy)) {
    const employment = targetEmploymentStatus(profile, criteria);
    const accepted = employmentStatusAccepted(employment, employmentPolicy);
    if (!accepted.pass) return { pass: false, reason: accepted.reason };
  }
  return { pass: true, reason: '通过宽松硬筛' };
}

// ── L2.5 Rule score ───────────────────────────────────────────────────────────
function ruleScore(profile, criteria) {
  const dims = criteria.scoring_dimensions || [];
  const targetCos = criteria.hard_filters?.any_of_companies || [];
  const kwList = criteria.hard_filters?.must_have_any_kw || [];
  const text = buildProfileText(profile).toLowerCase();
  const targetPosition = findTargetPosition(profile, criteria);
  const currentCo = targetPosition?.company || profile.positions?.[0]?.company || '';
  const allCos = (profile.positions || []).map(p => p.company || '');
  const currentYear = new Date().getFullYear();

  const scores = dims.map(d => {
    switch (d.key) {
      case 'company_match': {
        if (targetPosition && (!targetPosition.endYear || targetPosition.endYear >= currentYear)) return 100;
        if (targetPosition) return 80;
        if (targetCos.some(c => allCos.some(co => fuzzyMatch(c, co)))) return 70;
        return 20;
      }
      case 'topic_depth': {
        const hitCount = kwList.filter(kw => text.includes(kw.toLowerCase())).length;
        return Math.round((hitCount / Math.max(kwList.length, 1)) * 100);
      }
      case 'seniority_focus':
      case 'target_role_duration':
      case 'target_company_role_duration': {
        return targetRoleDurationScore(profile, criteria);
      }
      case 'employment_recency':
      case 'target_employment_recency':
      case 'current_or_recent_departure': {
        return employmentRecencyScore(profile, criteria);
      }
      case 'bonus': {
        const bonusKws = d.bonus_keywords || [];
        return bonusKws.some(kw => text.includes(kw.toLowerCase())) ? 60 : 20;
      }
      default:
        return semanticDimensionScore(d, profile, criteria);
    }
  });

  const weights = dims.map(d => d.weight ?? 1 / dims.length);
  const total = Math.round(scores.reduce((s, v, i) => s + v * weights[i], 0));
  return { dimScores: scores, score: total };
}

function ruleReasoning(profile, dimScores, dims, criteria) {
  const targetPosition = findTargetPosition(profile, criteria);
  const currentCo = profile.positions?.[0]?.company || '未知公司';
  const currentTitle = profile.positions?.[0]?.title || '未知职位';
  const reasonCo = targetPosition?.company || currentCo;
  const reasonTitle = targetPosition?.title || currentTitle;
  const topDim = dims[dimScores.indexOf(Math.max(...dimScores))];
  const botDim = dims[dimScores.indexOf(Math.min(...dimScores))];
  const currentNote = targetPosition && (targetPosition.company !== currentCo || targetPosition.title !== currentTitle)
    ? `；当前展示为 ${currentCo} ${currentTitle}`
    : '';
  const recencyNote = employmentNote(profile, criteria);
  const highlightTitle = /partner|alliance|gtm|go-to-market|marketplace|sales|solution|architect|business development|customer|product|technical|ai/i.test(reasonTitle)
    ? reasonTitle
    : 'relevant ecosystem work';
  return {
    reasoning: `${reasonCo} ${reasonTitle}，${topDim?.label || ''}高匹配${currentNote}${recencyNote}`,
    highlight_for_outreach: `Your ${highlightTitle} experience at ${reasonCo} is highly relevant —`,
    matched_signals: dims.filter((_, i) => dimScores[i] >= 70).map(d => d.label),
    missed_signals: dims.filter((_, i) => dimScores[i] < 50).map(d => d.label),
  };
}

// ── L3 Subagent score ────────────────────────────────────────────────────────
function positionsText(positions) {
  return (positions || []).slice(0, 12).map(p =>
    `${p.company || ''} | ${p.title || ''} | ${p.startYear || '?'}-${p.endYear || 'now'} | ${(p.desc || '').slice(0, 180)}`
  ).join('\n');
}

function hitsSummary(hits) {
  return (hits || []).map(h => [h.kw, h.strategy, h.company].filter(Boolean).join('@')).join(' + ');
}

function buildLlmPrompt(candidate, criteria) {
  const dims = criteria.scoring_dimensions || [];
  const weights = Object.fromEntries(dims.map(d => [d.key, d.weight ?? 0]));
  return `你是股票投资研究专家访谈的 LinkedIn 候选人评分员。请只基于候选人 Profile 和搜索命中信号评分，不要编造未显示的信息。

【研究背景】
${criteria.research_precheck?.research_context || criteria.topic_specific || ''}

【研究问题】
${(criteria.research_questions || []).map(q => `- ${q.ask}`).join('\n')}

【评分维度】
${dims.map(d => `- ${d.key} (${d.label}, weight ${d.weight}): ${d.description}`).join('\n')}

【评分口径】
100 = 直接高度匹配；75 = 明显匹配；50 = 部分相关但证据不足；25 = 弱相关；0 = 不相关。
如果候选人缺少直接回答核心问题的证据，但具备相关生态、实践或客户接触经验，可以作为 Tier 2/3 backup；不能因为公司或关键词接近就给 Tier 1。
优先判断候选人是否具备 ${asArray(criteria.must_answer_evidence).join(' / ') || 'direct evidence for the core research questions'}。
输出 score 必须按权重加权；权重为：${JSON.stringify(weights)}。

【候选人 Profile】
姓名：${candidate.name}
当前：${candidate.current_title || ''} @ ${candidate.current_company || ''}
Headline：${candidate.headline || ''}
经历：
${positionsText(candidate.positions)}
学历：${(candidate.educations || []).map(e => [e.school, e.degree, e.field].filter(Boolean).join(' · ')).join('; ')}
技能：${(candidate.skills || []).join(', ')}
搜索命中：${hitsSummary(candidate.hits)}

【输出 JSON，仅输出 JSON，不要 markdown】
{
  "scores_breakdown": ${JSON.stringify(dims.map(d => ({ key: d.key, score: 50 })))},
  "score": 50,
  "tier": 2,
  "reasoning": "1-2句中文，说明为什么适合或不适合验证本投研问题",
  "matched_signals": ["具体命中信号"],
  "missed_signals": ["具体缺失信号"],
  "highlight_for_outreach": "英文一句，适合 Connect note 的个性化亮点；保持研究话题模糊，不要暴露用户真正要验证的具体公司关系、产品线、交易或投资假设"
}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('LLM response did not contain JSON');
}

function defaultSubagentInputPath(opts) {
  if (opts.batchId) return phase3SubagentInputPath(opts.batchId);
  const dir = dirname(opts.output);
  const base = basename(opts.output).replace(/^phase3_/, '').replace(/\.json$/, '');
  return resolve(dir, `phase3_subagent_input_${base}.json`);
}

function defaultSubagentScoresPath(opts) {
  if (opts.batchId) return phase3SubagentScoresPath(opts.batchId);
  const dir = dirname(opts.output);
  const base = basename(opts.output).replace(/^phase3_/, '').replace(/\.json$/, '');
  return resolve(dir, `phase3_subagent_scores_${base}.json`);
}

function normalizeLlmScore(parsed, criteria, fallback) {
  const dims = criteria.scoring_dimensions || [];
  const byKey = new Map((parsed.scores_breakdown || []).map(d => [d.key, Number(d.score)]));
  const scores_breakdown = dims.map((d, i) => {
    const fallbackScore = fallback.scores_breakdown?.[i]?.score ?? 50;
    const n = byKey.has(d.key) ? byKey.get(d.key) : fallbackScore;
    return { key: d.key, score: Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : fallbackScore))) };
  });
  const score = Math.round(scores_breakdown.reduce((sum, d, i) =>
    sum + d.score * (dims[i]?.weight ?? 1 / Math.max(dims.length, 1)), 0));
  const tier = score >= 75 ? 1 : score >= 50 ? 2 : score >= 30 ? 3 : 0;
  return {
    scores_breakdown,
    score,
    tier,
    reasoning: String(parsed.reasoning || fallback.reasoning || ''),
    matched_signals: asArray(parsed.matched_signals).map(String),
    missed_signals: asArray(parsed.missed_signals).map(String),
    highlight_for_outreach: String(parsed.highlight_for_outreach || fallback.highlight_for_outreach || ''),
    scored_by: 'llm',
  };
}

function buildSubagentPayload(results, criteria, opts) {
  const shouldRun = opts.forceSubagent || results.passed.length >= opts.subagentThreshold;
  if (!opts.useLlm) {
    return { shouldRun: false, summary: { mode: 'subagent', status: 'disabled', attempted: 0, succeeded: 0, skipped: results.passed.length } };
  }
  if (!shouldRun) {
    return {
      shouldRun: false,
      summary: {
        mode: 'subagent',
        status: 'below_threshold',
        attempted: 0,
        succeeded: 0,
        skipped: results.passed.length,
        threshold: opts.subagentThreshold,
      },
    };
  }

  const payload = {
    batch_id: opts.batchId || null,
    created_at: new Date().toISOString(),
    scoring_dimensions: criteria.scoring_dimensions || [],
    topic_specific: criteria.topic_specific || '',
    research_context: criteria.research_precheck?.research_context || '',
    research_questions: criteria.research_questions || [],
    candidates: results.passed.map(candidate => ({
      vanity: candidate.vanity,
      name: candidate.name,
      current_company: candidate.current_company || '',
      current_title: candidate.current_title || '',
      headline: candidate.headline || '',
      location: candidate.location || '',
      positions: candidate.positions || [],
      educations: candidate.educations || [],
      skills: candidate.skills || [],
      hits: candidate.hits || [],
      fallback_rule_score: candidate.score,
      fallback_rule_tier: candidate.tier,
      fallback_scores_breakdown: candidate.scores_breakdown || [],
      fallback_reasoning: candidate.reasoning || '',
      prompt: buildLlmPrompt(candidate, criteria),
    })),
    output_schema: {
      candidate_results: [
        {
          vanity: 'string',
          scores_breakdown: [{ key: 'string', score: 50 }],
          score: 50,
          tier: 2,
          reasoning: 'string',
          matched_signals: ['string'],
          missed_signals: ['string'],
          highlight_for_outreach: 'string',
        },
      ],
    },
  };

  const outPath = defaultSubagentInputPath(opts);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return {
    shouldRun: true,
    inputPath: outPath,
    summary: {
      mode: 'subagent',
      status: 'pending',
      attempted: results.passed.length,
      succeeded: 0,
      skipped: 0,
      input_path: outPath,
      expected_scores_path: defaultSubagentScoresPath(opts),
    },
  };
}

function applySubagentScores(results, criteria, opts) {
  if (!opts.useLlm) {
    console.log('[llm] 已跳过 (--no-llm 或 LINKEDIN_TALENT_LLM=0)');
    return { attempted: 0, succeeded: 0, skipped: results.passed.length };
  }
  if (!opts.scores || !existsSync(opts.scores)) {
    throw new Error(`subagent scores 文件不存在: ${opts.scores || '(missing --scores)'}`);
  }
  const raw = readFileSync(opts.scores, 'utf8');
  const parsed = extractJson(raw);
  const candidateResults = asArray(parsed.candidate_results || parsed.results || parsed);
  const scoreMap = new Map(candidateResults.map(item => [item.vanity, item]));
  let attempted = results.passed.length;
  let succeeded = 0;
  for (const c of results.passed) {
    const item = scoreMap.get(c.vanity);
    process.stdout.write(`[llm/apply] ${c.name} ... `);
    if (!item) {
      c.llm_error = 'subagent result missing';
      console.log('fallback rule (missing)');
      continue;
    }
    try {
      const llm = normalizeLlmScore(item, criteria, c);
      Object.assign(c, llm, { llm_error: null });
      succeeded++;
      console.log(`score=${c.score} tier=${c.tier}`);
    } catch (e) {
      c.llm_error = e.message;
      console.log(`fallback rule (${e.message})`);
    }
  }
  return {
    mode: 'subagent',
    status: 'applied',
    attempted,
    succeeded,
    skipped: attempted - succeeded,
    scores_path: opts.scores,
  };
}

// ── Profile fetch ─────────────────────────────────────────────────────────────
function getProfileScript(vanity) {
  return `(async () => {
  const csrf = document.cookie.match(/JSESSIONID=\\"?([^;\\"]+)/)?.[1] || '';
  const resp = await fetch('https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${vanity}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93', {
    headers: {'Accept':'application/vnd.linkedin.normalized+json+2.1','x-restli-protocol-version':'2.0.0','csrf-token':csrf},
    credentials:'include',
  });
  if (!resp.ok) return JSON.stringify({_error: resp.status});
  const data = await resp.json();
  const inc = data.included || [];
  const p = inc.find(i => (i.entityUrn||'').includes('fsd_profile') && i.firstName) || {};
  const positions = inc.filter(i => (i['$type']||'').includes('Position') && i.title);
  const educations = inc.filter(i => (i['$type']||'').includes('Education') && i.schoolName);
  const skills = inc.filter(i => (i['$type']||'').includes('Skill') && i.name);
  return JSON.stringify({
    urn: p.entityUrn||'', firstName: p.firstName||'', lastName: p.lastName||'',
    headline: p.headline||'', summary: (p.summary||'').slice(0,500),
    location: p.geoLocationName||'',
    positions: positions.map(x => ({title:x.title, company:x.companyName, startYear:x.dateRange?.start?.year, endYear:x.dateRange?.end?.year, desc:x.description||''})),
    educations: educations.map(x => ({school:x.schoolName, degree:x.degreeName, field:x.fieldOfStudy, startYear:x.dateRange?.start?.year, endYear:x.dateRange?.end?.year})),
    skills: skills.slice(0,10).map(x => x.name),
  });
})()`;
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const baseCriteria = {
    target_companies: [{ name: 'Google', priority: 1 }],
    hard_filters: {
      any_of_companies: ['Google'],
      title_must_match_any: ['Sales', 'GTM'],
      target_employment: {
        mode: 'current_or_recent_departure',
        accepted_statuses: ['current', 'departed_recent'],
        max_years_since_left: 1,
        hard_filter: false,
        source: 'default_assumption',
      },
    },
    scoring_dimensions: [
      { key: 'company_match', label: '公司匹配', weight: 0.25, description: '目标公司经历' },
      { key: 'topic_depth', label: '岗位匹配', weight: 0.25, description: 'AI sales / GTM' },
      { key: 'target_role_duration', label: '目标岗时长', weight: 0.25, description: '目标岗位累计时长' },
      { key: 'employment_recency', label: '在职/离职窗口', weight: 0.25, description: '现任或 1 年内离职优先' },
    ],
  };
  const currentLong = {
    headline: 'AI Sales Lead at Google',
    positions: [{ company: 'Google', title: 'AI Sales Lead', startYear: 2021, desc: 'AI GTM and enterprise sales' }],
    skills: ['AI', 'Sales', 'GTM'],
  };
  const currentShort = {
    headline: 'GTM at Google',
    positions: [{ company: 'Google', title: 'GTM', startYear: new Date().getFullYear(), desc: 'AI GTM' }],
    skills: ['AI', 'GTM'],
  };
  const departedRecent = {
    headline: 'Former GTM Lead at Google',
    positions: [
      { company: 'Startup', title: 'Advisor', startYear: new Date().getFullYear(), desc: 'Advisory' },
      { company: 'Google', title: 'GTM Lead', startYear: 2022, endYear: new Date().getFullYear(), desc: 'AI GTM and customer adoption' },
    ],
    skills: ['AI', 'GTM'],
  };
  const departedOld = {
    headline: 'Former Sales Lead at Google',
    positions: [
      { company: 'OtherCo', title: 'Advisor', startYear: 2025, desc: 'Advisory' },
      { company: 'Google', title: 'Sales Lead', startYear: 2018, endYear: 2022, desc: 'AI sales' },
    ],
    skills: ['AI', 'Sales'],
  };

  const longEmploymentScore = employmentRecencyScore(currentLong, baseCriteria);
  const shortEmploymentScore = employmentRecencyScore(currentShort, baseCriteria);
  const oldEmploymentScore = employmentRecencyScore(departedOld, baseCriteria);
  assertSelfTest(longEmploymentScore > shortEmploymentScore, `expected long current > short current, got ${longEmploymentScore} <= ${shortEmploymentScore}`);
  assertSelfTest(shortEmploymentScore > oldEmploymentScore, `expected short current > old departed, got ${shortEmploymentScore} <= ${oldEmploymentScore}`);
  assertSelfTest(hardFilter(departedOld, baseCriteria.hard_filters).pass, 'default assumption should not hard-filter old departed candidates');

  const strictCriteria = JSON.parse(JSON.stringify(baseCriteria));
  strictCriteria.hard_filters.target_employment.hard_filter = true;
  strictCriteria.hard_filters.target_employment.source = 'user_explicit';
  assertSelfTest(hardFilter(currentLong, strictCriteria.hard_filters).pass, 'strict explicit policy should allow current candidates');
  assertSelfTest(hardFilter(departedRecent, strictCriteria.hard_filters).pass, 'strict explicit policy should allow recent departed candidates');
  const strictOld = hardFilter(departedOld, strictCriteria.hard_filters);
  assertSelfTest(!strictOld.pass && /离职超过 1 年/.test(strictOld.reason), `strict explicit policy should reject old departed candidates, got: ${strictOld.reason}`);

  const { dimScores } = ruleScore(currentLong, baseCriteria);
  assertSelfTest(baseCriteria.scoring_dimensions.some((d, i) => d.key === 'employment_recency' && dimScores[i] === longEmploymentScore), 'employment_recency dimension was not scored');
  console.log(JSON.stringify({
    ok: true,
    employment_recency_scores: {
      current_long: longEmploymentScore,
      current_short: shortEmploymentScore,
      departed_old_default: oldEmploymentScore,
    },
    strict_old_reject_reason: strictOld.reason,
  }, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (opts.selfTest) {
    runSelfTest();
    return;
  }

  const rawData = JSON.parse(readFileSync(opts.input, 'utf8'));
  const candidates = rawData.candidates || rawData; // 支持数组或 {candidates:[...]}
  const criteria = JSON.parse(readFileSync(opts.criteria, 'utf8'));

  // 权重归一化校验
  const weights = criteria.scoring_dimensions.map(d => d.weight ?? 0);
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(wSum - 1.0) > 0.01) {
    criteria.scoring_dimensions.forEach(d => d.weight = d.weight / wSum);
    console.warn(`[warn] 权重之和 ${wSum.toFixed(2)} != 1.0，已自动归一化`);
  }

  if (opts.llmOnly) {
    if (!existsSync(opts.output)) {
      console.error(`[error] --llm-only 需要已有 phase3 输出: ${opts.output}`);
      process.exit(1);
    }
    const current = JSON.parse(readFileSync(opts.output, 'utf8'));
    const results = { passed: current.passed || [], failed: current.failed || [] };
    const llm = applySubagentScores(results, criteria, opts);
    const output = summarize(results, current.summary?.total || results.passed.length + results.failed.length, current.summary?.pre_dropped || 0, current.summary?.stop_reason, { llm });
    writeFileSync(opts.output, JSON.stringify(output, null, 2));
    console.log('\n── Subagent 重评完成 ───────────────────────────');
    console.log(`LLM成功: ${llm.succeeded}/${llm.attempted}`);
    console.log(`输出: ${opts.output}`);
    return;
  }

  if (opts.rescoreOnly) {
    if (!existsSync(opts.output)) {
      console.error(`[error] --rescore-only 需要已有 phase3 输出: ${opts.output}`);
      process.exit(1);
    }
    const current = JSON.parse(readFileSync(opts.output, 'utf8'));
    const results = { passed: current.passed || [], failed: current.failed || [] };
    for (const c of results.passed) {
      const { dimScores, score } = ruleScore(c, criteria);
      const tier = score >= 75 ? 1 : score >= 50 ? 2 : score >= 30 ? 3 : 0;
      const rr = ruleReasoning(c, dimScores, criteria.scoring_dimensions, criteria);
      c.scores_breakdown = criteria.scoring_dimensions.map((d, i) => ({ key: d.key, score: dimScores[i] }));
      c.score = score;
      c.tier = tier;
      c.scored_by = 'rule_v2';
      Object.assign(c, rr);
    }
    const output = summarize(
      results,
      current.summary?.total || results.passed.length + results.failed.length,
      current.summary?.pre_dropped || 0,
      current.summary?.stop_reason,
      { llm: { ...(current.summary?.llm || {}), status: 'rescore_only_rule_v2' } },
    );
    writeFileSync(opts.output, JSON.stringify(output, null, 2));
    console.log('\n── 规则重评分完成 ───────────────────────────');
    console.log(`重评候选: ${results.passed.length}`);
    console.log(`输出: ${opts.output}`);
    return;
  }

  // 断点续跑：加载已处理的 vanity 集合
  const doneVanities = new Set();
  const resumeResults = { passed: [], failed: [] };
  if (opts.resume && existsSync(opts.resume)) {
    const prev = JSON.parse(readFileSync(opts.resume, 'utf8'));
    (prev.passed || []).forEach(c => { doneVanities.add(c.vanity); resumeResults.passed.push(c); });
    (prev.failed || []).forEach(c => { doneVanities.add(c.vanity); resumeResults.failed.push(c); });
    console.log(`[resume] 已跳过 ${doneVanities.size} 人`);
  }

  // 预过滤
  const preFiltered = candidates.filter(c => !doneVanities.has(c.vanity) && preFilter(c, criteria));
  const preDropped = candidates.length - doneVanities.size - preFiltered.length;
  console.log(`[pre-filter] ${candidates.length} → ${preFiltered.length} (丢弃 ${preDropped} 噪声)`);

  const results = { passed: [...resumeResults.passed], failed: [...resumeResults.failed] };
  let stopReason = null;

  for (let i = 0; i < preFiltered.length; i++) {
    const cand = preFiltered[i];
    process.stdout.write(`[${i + 1}/${preFiltered.length}] ${cand.name} (${cand.vanity}) ... `);

    // 拉 Profile
    let profile;
    try {
      profile = opencliEval(getProfileScript(cand.vanity));
    } catch (e) {
      console.log(`fetch error: ${e.message}`);
      results.failed.push({ ...cand, reason: `fetch error: ${e.message}` });
      continue;
    }

    if (profile._error) {
      const code = profile._error;
      console.log(`HTTP ${code}`);
      if ([401, 403, 429].includes(code)) {
        stopReason = `HTTP ${code}，整批停止`;
        break;
      }
      results.failed.push({ ...cand, reason: `HTTP ${code}` });
      continue;
    }
    profile.hits = cand.hits || [];
    profile.search_card_headline = cand.headline || '';

    // L2 硬筛
    const l2 = hardFilter(profile, criteria);
    if (!l2.pass) {
      console.log(`L2 fail: ${l2.reason}`);
      results.failed.push({ name: cand.name, headline: cand.headline, vanity: cand.vanity, reason: l2.reason });
      await sleep(randInt(200, 600)); // L2 失败不拉 Profile，短暂停一下再继续
      continue;
    }

    // L2.5 规则评分
    const { dimScores, score } = ruleScore(profile, criteria);
    const tier = score >= 75 ? 1 : score >= 50 ? 2 : score >= 30 ? 3 : 0;
    const rr = ruleReasoning(profile, dimScores, criteria.scoring_dimensions, criteria);

    const scores_breakdown = criteria.scoring_dimensions.map((d, i) => ({ key: d.key, score: dimScores[i] }));
    const candidate = {
      vanity: cand.vanity, urn: profile.urn || cand.urn,
      name: `${profile.firstName} ${profile.lastName}`.trim() || cand.name,
      first_name: profile.firstName || cand.name?.split(' ')[0] || '',
      last_name: profile.lastName || '',
      headline: profile.headline || cand.headline,
      location: profile.location,
      current_company: profile.positions?.[0]?.company || '',
      current_title:   profile.positions?.[0]?.title   || '',
      positions: profile.positions || [],
      experience_history: (profile.positions || []).map(p => `${p.company} | ${p.title} | ${p.startYear || '?'}-${p.endYear || 'now'}`).join('; '),
      educations: profile.educations || [],
      skills: profile.skills || [],
      hits: cand.hits || [],
      hard_filter_result: l2.reason,
      scores_breakdown,
      score,
      tier,
      scored_by: 'rule',
      ...rr,
      connect_status: '待确认',
    };

    results.passed.push(candidate);
    console.log(`✓ score=${score} tier=${tier} (rule)`);

    // 定期写中间结果（每 10 人）
    if ((i + 1) % 10 === 0) {
      writeFileSync(opts.output, JSON.stringify({ ...summarize(results, candidates.length, preDropped), _partial: true }, null, 2));
    }

    await humanDelay(i);
  }

  if (stopReason) console.error(`\n[STOP] ${stopReason}`);

  const llm = stopReason
    ? { mode: 'subagent', status: 'profile_fetch_stopped', attempted: 0, succeeded: 0, skipped: results.passed.length, reason: 'profile_fetch_stopped' }
    : buildSubagentPayload(results, criteria, opts).summary;

  const output = summarize(results, candidates.length, preDropped, stopReason, { llm });
  writeFileSync(opts.output, JSON.stringify(output, null, 2));

  console.log('\n── 完成 ──────────────────────────────────────');
  console.log(`总召回: ${candidates.length}  预筛丢弃: ${preDropped}  实际拉取: ${preFiltered.length}`);
  console.log(`L2通过: ${results.passed.length}  L2失败: ${results.failed.length}`);
  const t1 = results.passed.filter(c => c.tier === 1).length;
  const t2 = results.passed.filter(c => c.tier === 2).length;
  const t3 = results.passed.filter(c => c.tier === 3).length;
  console.log(`Tier分布: T1=${t1}  T2=${t2}  T3=${t3}`);
  if (llm?.status === 'pending') {
    console.log(`Subagent评分待执行: ${llm.input_path}`);
  } else if (llm?.attempted) {
    console.log(`LLM评分: ${llm.succeeded}/${llm.attempted}`);
  }
  console.log(`输出: ${opts.output}`);
  if (stopReason) console.log(`⚠️  ${stopReason}`);
}

function summarize(results, total, preDropped, stopReason, extra = {}) {
  const t = results.passed;
  return {
    summary: {
      total,
      pre_dropped: preDropped,
      profile_fetched: results.passed.length + results.failed.length,
      hard_pass: results.passed.length,
      hard_fail: results.failed.length,
      tier1: t.filter(c => c.tier === 1).length,
      tier2: t.filter(c => c.tier === 2).length,
      tier3: t.filter(c => c.tier === 3).length,
      excluded: t.filter(c => c.tier === 0).length,
      stop_reason: stopReason || null,
      llm: extra.llm || null,
      generated_at: new Date().toISOString(),
    },
    passed: results.passed.sort((a, b) => (b.score || 0) - (a.score || 0)),
    failed: results.failed,
  };
}

main().catch(e => { console.error(e); process.exit(1); });
