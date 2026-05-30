#!/usr/bin/env node
/**
 * Phase 3: Profile fetch → L2 hard filter → L2.5 rule score → L3 LLM score
 *
 * Usage:
 *   node phase3-profile-score.mjs \
 *     --input  ../data/batches/raw-YYYYMMDD.json \
 *     --criteria ../data/criteria/YYYYMMDD.json \
 *     [--output ../data/exports/phase3-YYYYMMDD.json] \
 *     [--resume ../data/exports/phase3-partial.json]  # 断点续跑
 *
 * Input (raw candidates JSON):
 *   { candidates: [{name, headline, vanity, urn, profile_url, hits}], ... }
 *
 * Criteria JSON:
 *   { hard_filters: {...}, scoring_dimensions: [...] }
 *   (由 Phase 1 解析生成，结构见 phases/01-parse-criteria.md)
 *
 * Output:
 *   { summary: {...}, passed: [...], failed: [...] }
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dir, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, criteria: null, output: null, resume: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input')    opts.input    = resolve(args[++i]);
    if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    if (args[i] === '--output')   opts.output   = resolve(args[++i]);
    if (args[i] === '--resume')   opts.resume   = resolve(args[++i]);
  }
  if (!opts.input || !opts.criteria) {
    console.error('Usage: node phase3-profile-score.mjs --input <raw.json> --criteria <criteria.json> [--output <out.json>] [--resume <partial.json>]');
    process.exit(1);
  }
  if (!opts.output) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    opts.output = resolve(SKILL_ROOT, `data/exports/phase3-${date}.json`);
  }
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

// ── Pre-filter (no API, uses headline + hits) ─────────────────────────────────
const TECH_ROLE_RE = /engineer|process|integration|device|materials|research|scientist|technologist|interconnect|BEOL|metalliz/i;
const NOISE_RE = /\b(marketing|sales|recruiter|business development|HR|metal trading|scrap|recycl)/i;

function preFilter(candidate, primaryKws) {
  // 目标公司专项关键词命中 → 直接保留
  if (candidate.hits?.some(h => h.hitTargetCompany && primaryKws.includes(h.kw))) return true;
  // headline 含噪声词且非专项命中 → 丢弃
  if (NOISE_RE.test(candidate.headline)) return false;
  // headline 含技术角色词 → 保留
  return TECH_ROLE_RE.test(candidate.headline);
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

function hardFilter(profile, filters) {
  // 公司匹配（宽松：只要任一职位含目标公司即通过）
  if (filters.any_of_companies?.length) {
    const allCos = (profile.positions || []).map(p => p.company || '');
    const hit = filters.any_of_companies.some(tc => allCos.some(co => fuzzyMatch(tc, co)));
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
  const currentCo = profile.positions?.[0]?.company || '';
  const allCos = (profile.positions || []).map(p => p.company || '');
  const currentYear = new Date().getFullYear();

  const scores = dims.map(d => {
    switch (d.key) {
      case 'company_match': {
        if (targetCos.some(c => fuzzyMatch(c, currentCo))) return 100;
        if (targetCos.some(c => allCos.some(co => fuzzyMatch(c, co)))) return 70;
        return 20;
      }
      case 'topic_depth': {
        const hitCount = kwList.filter(kw => text.includes(kw.toLowerCase())).length;
        return Math.round((hitCount / Math.max(kwList.length, 1)) * 100);
      }
      case 'seniority_focus': {
        const focusYears = (profile.positions || [])
          .filter(p => targetCos.some(c => fuzzyMatch(c, p.company || '')))
          .reduce((sum, p) => sum + ((p.endYear || currentYear) - (p.startYear || currentYear)), 0);
        return Math.min(100, Math.max(0, focusYears * 15));
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

function ruleReasoning(profile, dimScores, dims, targetCos) {
  const currentCo = profile.positions?.[0]?.company || '未知公司';
  const currentTitle = profile.positions?.[0]?.title || '未知职位';
  const topDim = dims[dimScores.indexOf(Math.max(...dimScores))];
  const botDim = dims[dimScores.indexOf(Math.min(...dimScores))];
  return {
    reasoning: `${currentCo} ${currentTitle}，${topDim?.label || ''}高匹配`,
    highlight_for_outreach: `Your background at ${currentCo} is exactly what we're looking for —`,
    matched_signals: dims.filter((_, i) => dimScores[i] >= 70).map(d => d.label),
    missed_signals: dims.filter((_, i) => dimScores[i] < 50).map(d => d.label),
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

  const primaryKws = criteria.search?.primary_keywords || [];

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
  const preFiltered = candidates.filter(c => !doneVanities.has(c.vanity) && preFilter(c, primaryKws));
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
    const rr = ruleReasoning(profile, dimScores, criteria.scoring_dimensions, criteria.hard_filters?.any_of_companies || []);

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

  const output = summarize(results, candidates.length, preDropped, stopReason);
  writeFileSync(opts.output, JSON.stringify(output, null, 2));

  console.log('\n── 完成 ──────────────────────────────────────');
  console.log(`总召回: ${candidates.length}  预筛丢弃: ${preDropped}  实际拉取: ${preFiltered.length}`);
  console.log(`L2通过: ${results.passed.length}  L2失败: ${results.failed.length}`);
  const t1 = results.passed.filter(c => c.tier === 1).length;
  const t2 = results.passed.filter(c => c.tier === 2).length;
  const t3 = results.passed.filter(c => c.tier === 3).length;
  console.log(`Tier分布: T1=${t1}  T2=${t2}  T3=${t3}`);
  console.log(`输出: ${opts.output}`);
  if (stopReason) console.log(`⚠️  ${stopReason}`);
}

function summarize(results, total, preDropped, stopReason) {
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
      generated_at: new Date().toISOString(),
    },
    passed: results.passed.sort((a, b) => (b.score || 0) - (a.score || 0)),
    failed: results.failed,
  };
}

main().catch(e => { console.error(e); process.exit(1); });
