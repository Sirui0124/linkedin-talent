#!/usr/bin/env node
/**
 * Phase 2: LinkedIn search recall (L1)
 *
 * Usage:
 *   node scripts/phase2-search-recall.mjs --batch-id <id>
 *
 * Advanced:
 *   node scripts/phase2-search-recall.mjs \
 *     --criteria data/criteria/<id>.json \
 *     --output data/exports/raw_<id>.json \
 *     [--dry-run]
 *
 * Output: { summary, candidates }
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  criteriaPath, rawCandidatesPath, ensureDataDirs,
} from '../lib/paths.js';
import { isValidBatchId, parseBatchId } from '../lib/naming.js';
import {
  getCompanyId, buildCompanyFilter, SEARCH_STRATEGIES, DEFAULT_SEARCH_CONFIG,
} from '../lib/config.js';
import {
  searchCandidatesScript, parseSearchError,
} from '../lib/voyager.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    batchId: null,
    criteria: null,
    output: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id') opts.batchId = args[++i];
    else if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    else if (args[i] === '--output') opts.output = resolve(args[++i]);
    else if (args[i] === '--dry-run') opts.dryRun = true;
  }

  if (opts.batchId) {
    if (!isValidBatchId(opts.batchId)) {
      console.error(`[error] 非法 batch-id: ${opts.batchId}（格式: search_YYYYMMDD_HHMM[_LABEL]）`);
      process.exit(1);
    }
    opts.criteria ??= criteriaPath(opts.batchId);
    opts.output ??= rawCandidatesPath(opts.batchId);
  }

  if (!opts.criteria) {
    console.error('Usage: node scripts/phase2-search-recall.mjs --batch-id <id>');
    console.error('   or: node scripts/phase2-search-recall.mjs --criteria <criteria.json> [--output <raw.json>] [--dry-run]');
    process.exit(1);
  }

  opts.batchId ??= parseBatchId(opts.criteria) || 'manual';
  opts.output ??= rawCandidatesPath(opts.batchId);
  ensureDataDirs();
  return opts;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniq(values) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function randMs(rangeSeconds) {
  const [lo, hi] = rangeSeconds || [3, 5];
  const sec = lo + Math.random() * (hi - lo);
  return Math.round(sec * 1000);
}

function parseRange(value, fallbackMin, fallbackMax) {
  if (typeof value === 'number') return [value, fallbackMax];
  const text = String(value || '');
  const match = text.match(/(\d+)\D+(\d+)/);
  if (match) return [Number(match[1]), Number(match[2])];
  return [fallbackMin, fallbackMax];
}

function getRecallTargets(criteria) {
  const mode = criteria.delivery_mode?.mode || 'calibration';
  const defaultMin = mode === 'full_run' ? 300 : 100;
  const defaultMax = mode === 'full_run' ? 500 : 200;
  const [poolMin, poolMax] = parseRange(criteria.delivery_mode?.search_pool, defaultMin, defaultMax);
  const recall = criteria.search_recall || criteria.searchRecall || {};
  return {
    targetMin: Number(recall.target_min || recall.targetMin || poolMin),
    targetMax: Number(recall.target_max || recall.targetMax || poolMax),
    targetPerSearch: Number(recall.target_per_search || recall.targetPerSearch || 60),
  };
}

function getKeywordStages(criteria) {
  const sk = criteria.search_keywords || {};
  const legacy = criteria.search || {};
  return {
    primary: uniq([...asArray(sk.primary), ...asArray(legacy.primary), ...asArray(legacy.primary_keywords)]),
    secondary: uniq([...asArray(sk.secondary), ...asArray(legacy.secondary), ...asArray(legacy.secondary_keywords)]),
    fallback: uniq([...asArray(sk.fallback), ...asArray(legacy.fallback), ...asArray(legacy.fallback_keywords)]),
  };
}

function getTargetCompanies(criteria) {
  return asArray(criteria.target_companies)
    .map(c => (typeof c === 'string' ? { name: c, priority: 99 } : c))
    .filter(c => c?.name)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function containsCompanyName(keyword, companyName) {
  const kw = String(keyword || '').toLowerCase();
  const name = String(companyName || '').toLowerCase();
  if (!name) return false;
  if (kw.includes(name)) return true;
  const stop = new Set(['digital', 'consulting', 'services', 'service', 'group', 'company', 'corporation', 'inc', 'llc']);
  const rawTokens = name
    .split(/[^a-z0-9]+/i)
    .map(t => t.trim())
    .filter(t => t.length >= 3);
  const tokens = rawTokens.filter(t => !stop.has(t));
  const acronym = rawTokens.map(t => t[0]).join('');
  return tokens.some(t => kw.includes(t)) || (acronym.length >= 3 && kw.includes(acronym));
}

function buildFallbackCompanyKeyword(keyword, companyName) {
  return containsCompanyName(keyword, companyName) ? keyword : `${companyName} ${keyword}`.trim();
}

function buildSearchPlan(criteria) {
  const stages = getKeywordStages(criteria);
  const companies = getTargetCompanies(criteria);
  const matrix = asArray(criteria.search_keywords?.company_topic_matrix);
  const { targetPerSearch } = getRecallTargets(criteria);
  const pages = Math.max(1, Math.ceil(targetPerSearch / DEFAULT_SEARCH_CONFIG.pageSize));
  const plan = [];

  if (matrix.length) {
    for (const row of matrix) {
      const companyName = row.company;
      const companyId = getCompanyId(companyName);
      for (const keyword of uniq(asArray(row.queries))) {
        if (companyId) {
          for (const strategy of [SEARCH_STRATEGIES.CURRENT_COMPANY, SEARCH_STRATEGIES.PAST_COMPANY]) {
            plan.push({ stage: 'primary', keyword, strategy, companyName, companyId, pages });
          }
        } else {
          plan.push({
            stage: 'primary',
            keyword: buildFallbackCompanyKeyword(keyword, companyName),
            strategy: SEARCH_STRATEGIES.KEYWORD_ONLY,
            companyName,
            companyId: null,
            pages,
            note: 'company_id_missing_keyword_fallback',
          });
        }
      }
    }
  } else if (companies.length) {
    for (const keyword of stages.primary) {
      for (const company of companies) {
        const companyId = getCompanyId(company.name);
        if (companyId) {
          for (const strategy of [SEARCH_STRATEGIES.CURRENT_COMPANY, SEARCH_STRATEGIES.PAST_COMPANY]) {
            plan.push({ stage: 'primary', keyword, strategy, companyName: company.name, companyId, pages });
          }
        } else {
          plan.push({
            stage: 'primary',
            keyword: buildFallbackCompanyKeyword(keyword, company.name),
            strategy: SEARCH_STRATEGIES.KEYWORD_ONLY,
            companyName: company.name,
            companyId: null,
            pages,
            note: 'company_id_missing_keyword_fallback',
          });
        }
      }
    }
  } else {
    for (const keyword of stages.primary) {
      plan.push({ stage: 'primary', keyword, strategy: SEARCH_STRATEGIES.KEYWORD_ONLY, pages });
    }
  }

  for (const stage of ['secondary', 'fallback']) {
    for (const keyword of stages[stage]) {
      plan.push({ stage, keyword, strategy: SEARCH_STRATEGIES.KEYWORD_ONLY, pages });
    }
  }

  return plan;
}

function parseOpencliResult(raw) {
  const text = String(raw || '').trim();
  const first = JSON.parse(text);
  return typeof first === 'string' ? JSON.parse(first) : first;
}

function opencliEval(script) {
  const raw = execFileSync('opencli', ['browser', 'linkedin', 'eval', script], {
    timeout: 45_000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseOpencliResult(raw);
}

function candidateKey(candidate) {
  return candidate.vanity || candidate.profile_url || candidate.urn || candidate.name;
}

function mergeCandidate(store, candidate, hit) {
  const key = candidateKey(candidate);
  if (!key) return;
  const existing = store.get(key);
  if (existing) {
    existing.hits = existing.hits || [];
    existing.hits.push(hit);
    if (!existing.urn && candidate.urn) existing.urn = candidate.urn;
    if (!existing.headline && candidate.headline) existing.headline = candidate.headline;
    if (!existing.location && candidate.location) existing.location = candidate.location;
    return;
  }
  store.set(key, {
    ...candidate,
    hits: [hit],
  });
}

function writeOutput(outputPath, summary, candidates, partial = false) {
  writeFileSync(outputPath, JSON.stringify({
    summary: { ...summary, partial },
    candidates,
  }, null, 2));
}

async function main() {
  const opts = parseArgs();
  const criteria = JSON.parse(readFileSync(opts.criteria, 'utf8'));
  const { targetMin, targetMax } = getRecallTargets(criteria);
  const plan = buildSearchPlan(criteria);

  if (!plan.length) {
    console.error('[error] criteria 中没有可执行搜索词。请检查 search_keywords.primary 或 company_topic_matrix。');
    process.exit(1);
  }

  console.log(`Phase 2 搜索计划: ${plan.length} 组调用 · 目标 ${targetMin}-${targetMax} 人`);
  if (opts.dryRun) {
    for (const [i, item] of plan.entries()) {
      console.log(`${i + 1}. [${item.stage}] ${item.keyword} · ${item.strategy}${item.companyName ? ` · ${item.companyName}` : ''}${item.note ? ` · ${item.note}` : ''}`);
    }
    return;
  }

  const store = new Map();
  const summary = {
    batch_id: opts.batchId,
    criteria_path: opts.criteria,
    output_path: opts.output,
    planned_groups: plan.length,
    api_calls: 0,
    stopped_at_stage: null,
    stop_reason: null,
    generated_at: null,
  };

  let currentStage = null;
  for (const item of plan) {
    const reached = store.size >= targetMin;
    if (item.stage === 'secondary' && reached) break;
    if (item.stage === 'fallback' && reached) break;

    if (currentStage !== item.stage) {
      currentStage = item.stage;
      console.log(`\n[${currentStage}] 开始 · 当前去重 ${store.size}`);
    }

    const companyFilter = item.companyId
      ? buildCompanyFilter(item.strategy, [item.companyId])
      : '';

    for (let page = 0; page < item.pages; page++) {
      const start = page * DEFAULT_SEARCH_CONFIG.pageSize;
      process.stdout.write(`- ${item.keyword} · ${item.strategy}${item.companyName ? ` · ${item.companyName}` : ''} · page ${page + 1}/${item.pages} ... `);

      let result;
      try {
        result = opencliEval(searchCandidatesScript(start, item.keyword, companyFilter));
      } catch (e) {
        console.log(`失败: ${e.message}`);
        summary.stop_reason = `opencli error: ${e.message}`;
        summary.stopped_at_stage = item.stage;
        break;
      }

      summary.api_calls += 1;
      const parsedError = parseSearchError(result);
      if (parsedError.shouldStop) {
        console.log(`停止: ${parsedError.reason}`);
        summary.stop_reason = parsedError.reason;
        summary.stopped_at_stage = item.stage;
        break;
      }

      const results = asArray(result.results);
      for (const candidate of results) {
        mergeCandidate(store, candidate, {
          kw: item.keyword,
          strategy: item.strategy,
          company: item.companyName || '',
          hitTargetCompany: Boolean(item.companyId),
          stage: item.stage,
        });
      }

      console.log(`+${results.length} · 去重 ${store.size}`);
      writeOutput(opts.output, summary, [...store.values()].slice(0, targetMax), true);

      if (summary.stop_reason || store.size >= targetMax) break;
      await sleep(randMs(DEFAULT_SEARCH_CONFIG.pageDelay.map(ms => ms / 1000)));
    }

    if (summary.stop_reason || store.size >= targetMax) break;
  }

  const candidates = [...store.values()].slice(0, targetMax);
  summary.generated_at = new Date().toISOString();
  summary.total = candidates.length;
  writeOutput(opts.output, summary, candidates, false);

  console.log('\n── Phase 2 完成 ─────────────────────────────');
  console.log(`去重候选: ${candidates.length}`);
  console.log(`API 调用: ${summary.api_calls}`);
  console.log(`输出: ${opts.output}`);
  if (summary.stop_reason) console.log(`停止原因: ${summary.stop_reason}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
