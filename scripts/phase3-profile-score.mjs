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
import { resolve } from 'path';
import { homedir } from 'os';
import {
  rawCandidatesPath, criteriaPath, phase3JsonPath, ensureDataDirs,
} from '../lib/paths.js';
import { isValidBatchId } from '../lib/naming.js';

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    batchId: null, input: null, criteria: null, output: null, resume: null,
    useLlm: process.env.LINKEDIN_TALENT_LLM !== '0',
    llmOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id') opts.batchId  = args[++i];
    if (args[i] === '--input')    opts.input    = resolve(args[++i]);
    if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    if (args[i] === '--output')   opts.output   = resolve(args[++i]);
    if (args[i] === '--resume')   opts.resume   = resolve(args[++i]);
    if (args[i] === '--no-llm')   opts.useLlm = false;
    if (args[i] === '--llm-only') opts.llmOnly = true;
  }
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
  return [profile.headline, profile.summary, posText, (profile.skills || []).join(' ')].join(' ');
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

function findTargetPosition(profile, criteria) {
  const positions = profile.positions || [];
  const targetCos = criteria.hard_filters?.any_of_companies || [];
  const titleKws = criteria.hard_filters?.title_must_match_any || [];
  const currentYear = new Date().getFullYear();

  const targetPositions = positions.filter(p => matchesAnyCompany(p.company, targetCos));
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
  const positions = profile.positions || [];
  const targetCos = criteria.hard_filters?.any_of_companies || [];
  const titleKws = criteria.hard_filters?.title_must_match_any || [];

  const targetPositions = positions.filter(p => matchesAnyCompany(p.company, targetCos));
  const roleMatches = targetPositions.filter(p =>
    !titleKws.length || titleKws.some(kw => fuzzyMatch(kw, p.title || ''))
  );
  return roleMatches.length ? roleMatches : targetPositions;
}

function targetRoleDuration(profile, criteria) {
  const currentYear = new Date().getFullYear();
  const positions = findTargetRolePositions(profile, criteria);
  let years = 0;
  let hasUnknownStart = false;

  for (const p of positions) {
    if (!p.startYear) {
      hasUnknownStart = true;
      continue;
    }
    years += Math.max(0, (p.endYear || currentYear) - p.startYear);
  }

  return { years, hasUnknownStart };
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

function hardFilter(profile, filters) {
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
  return { pass: true, reason: '通过宽松硬筛' };
}

// ── L2.5 Rule score ───────────────────────────────────────────────────────────
function ruleScore(profile, criteria) {
  const dims = criteria.scoring_dimensions;
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
      case 'bonus': {
        const bonusKws = d.bonus_keywords || [];
        return bonusKws.some(kw => text.includes(kw.toLowerCase())) ? 60 : 20;
      }
      default:
        return 50; // 未知维度给中间分
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
  return {
    reasoning: `${reasonCo} ${reasonTitle}，${topDim?.label || ''}高匹配${currentNote}`,
    highlight_for_outreach: `Your background at ${reasonCo} is exactly what we're looking for —`,
    matched_signals: dims.filter((_, i) => dimScores[i] >= 70).map(d => d.label),
    missed_signals: dims.filter((_, i) => dimScores[i] < 50).map(d => d.label),
  };
}

// ── L3 LLM score ─────────────────────────────────────────────────────────────
function loadLocalSecretsEnv() {
  const secretPath = resolve(homedir(), '.config/ai-secrets/env.zsh');
  if (!existsSync(secretPath)) return;
  const text = readFileSync(secretPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!/^ANTHROPIC_/.test(key) || process.env[key]) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function getLlmConfig() {
  loadLocalSecretsEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return {
    provider: 'anthropic',
    apiKey,
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    model: process.env.LINKEDIN_TALENT_LLM_MODEL || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  };
}

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
必须特别区分泛 power / 泛 ADI 经历和能验证 Google/TPU/AI infrastructure power 的强信号。
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
  "highlight_for_outreach": "英文一句，适合 Connect note 的个性化亮点，不能暴露 ADI+Google 具体研究指向"
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

async function callAnthropic(config, prompt) {
  const resp = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1200,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
  const data = JSON.parse(body);
  return (data.content || []).map(x => x.text || '').join('\n');
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

async function scoreCandidateWithLlm(candidate, criteria, config) {
  const prompt = buildLlmPrompt(candidate, criteria);
  const text = await callAnthropic(config, prompt);
  return normalizeLlmScore(extractJson(text), criteria, candidate);
}

async function applyLlmScores(results, criteria, opts) {
  if (!opts.useLlm) {
    console.log('[llm] 已跳过 (--no-llm 或 LINKEDIN_TALENT_LLM=0)');
    return { attempted: 0, succeeded: 0, skipped: results.passed.length };
  }
  const config = getLlmConfig();
  if (!config) {
    console.warn('[llm] 未找到 ANTHROPIC_API_KEY，保留规则评分');
    return { attempted: 0, succeeded: 0, skipped: results.passed.length, reason: 'missing_api_key' };
  }
  let attempted = 0;
  let succeeded = 0;
  let skipped = 0;
  for (const c of results.passed) {
    if (c.scored_by === 'llm' && !opts.llmOnly) {
      skipped++;
      continue;
    }
    attempted++;
    process.stdout.write(`[llm ${attempted}/${results.passed.length}] ${c.name} ... `);
    try {
      const llm = await scoreCandidateWithLlm(c, criteria, config);
      Object.assign(c, llm);
      succeeded++;
      console.log(`score=${c.score} tier=${c.tier}`);
    } catch (e) {
      c.llm_error = e.message;
      console.log(`fallback rule (${e.message})`);
      if (/auth|401|403|invalid.?api.?key/i.test(e.message)) {
        console.warn('[llm] 认证类错误，停止本轮 LLM 重试，保留其余规则评分');
        break;
      }
    }
    await sleep(250);
  }
  return { attempted, succeeded, skipped };
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
    positions: positions.map(x => ({title:x.title, company:x.companyName, startYear:x.dateRange?.start?.year, endYear:x.dateRange?.end?.year, desc:(x.description||'').slice(0,150)})),
    educations: educations.map(x => ({school:x.schoolName, degree:x.degreeName, field:x.fieldOfStudy, startYear:x.dateRange?.start?.year, endYear:x.dateRange?.end?.year})),
    skills: skills.slice(0,10).map(x => x.name),
  });
})()`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

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
    const llm = await applyLlmScores(results, criteria, opts);
    const output = summarize(results, current.summary?.total || results.passed.length + results.failed.length, current.summary?.pre_dropped || 0, current.summary?.stop_reason, { llm });
    writeFileSync(opts.output, JSON.stringify(output, null, 2));
    console.log('\n── LLM 重评完成 ───────────────────────────────');
    console.log(`LLM成功: ${llm.succeeded}/${llm.attempted}`);
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

    // L2 硬筛
    const l2 = hardFilter(profile, criteria.hard_filters || {});
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

  const llm = stopReason ? { attempted: 0, succeeded: 0, skipped: results.passed.length, reason: 'profile_fetch_stopped' }
    : await applyLlmScores(results, criteria, opts);

  const output = summarize(results, candidates.length, preDropped, stopReason, { llm });
  writeFileSync(opts.output, JSON.stringify(output, null, 2));

  console.log('\n── 完成 ──────────────────────────────────────');
  console.log(`总召回: ${candidates.length}  预筛丢弃: ${preDropped}  实际拉取: ${preFiltered.length}`);
  console.log(`L2通过: ${results.passed.length}  L2失败: ${results.failed.length}`);
  const t1 = results.passed.filter(c => c.tier === 1).length;
  const t2 = results.passed.filter(c => c.tier === 2).length;
  const t3 = results.passed.filter(c => c.tier === 3).length;
  console.log(`Tier分布: T1=${t1}  T2=${t2}  T3=${t3}`);
  if (llm?.attempted) console.log(`LLM评分: ${llm.succeeded}/${llm.attempted}`);
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
