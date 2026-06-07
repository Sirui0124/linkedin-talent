#!/usr/bin/env node
/**
 * Phase 7: Sync batch results into master dashboard.xlsx
 *
 * Usage:
 *   node scripts/phase7-sync-dashboard.mjs --batch-id <id>
 *
 * Advanced:
 *   node scripts/phase7-sync-dashboard.mjs \
 *     --phase3 data/exports/phase3_<id>.json \
 *     --criteria data/criteria/<id>.json \
 *     --excel data/batches/linkedin_<id>.xlsx \
 *     [--dashboard data/dashboard.xlsx]
 *
 * Output: data/dashboard.xlsx
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import {
  SKILL_ROOT, DASHBOARD_PATH, batchExcelPath, criteriaPath, phase3JsonPath,
  ensureDataDirs,
} from '../lib/paths.js';
import { isValidBatchId, parseBatchId } from '../lib/naming.js';
import { tierToStars } from '../lib/config.js';

function loadXlsx() {
  const localPath = resolve(SKILL_ROOT, 'node_modules/xlsx/xlsx.mjs');
  if (existsSync(localPath)) return import(localPath);
  try {
    const require = createRequire(import.meta.url);
    return import(require.resolve('xlsx'));
  } catch {
    console.error('[error] xlsx 依赖未安装。请在 skill 根目录运行:');
    console.error(`  cd ${SKILL_ROOT} && npm install`);
    process.exit(1);
  }
}
const XLSX = await loadXlsx();

const ACTIONED_STATUSES = new Set(['已发送', 'CANT_RESEND', '失败', '已接受', '已 follow-up']);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    batchId: null,
    phase3: null,
    criteria: null,
    excel: null,
    dashboard: DASHBOARD_PATH,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id') opts.batchId = args[++i];
    else if (args[i] === '--phase3') opts.phase3 = resolve(args[++i]);
    else if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    else if (args[i] === '--excel') opts.excel = resolve(args[++i]);
    else if (args[i] === '--dashboard') opts.dashboard = resolve(args[++i]);
  }

  if (opts.batchId) {
    if (!isValidBatchId(opts.batchId)) {
      console.error(`[error] 非法 batch-id: ${opts.batchId}（格式: search_YYYYMMDD_HHMM[_LABEL]）`);
      process.exit(1);
    }
    opts.phase3 ??= phase3JsonPath(opts.batchId);
    opts.criteria ??= criteriaPath(opts.batchId);
    opts.excel ??= batchExcelPath(opts.batchId);
  } else {
    opts.batchId = parseBatchId(opts.phase3 || opts.excel || '') || null;
  }

  if (!opts.phase3) {
    console.error('Usage: node scripts/phase7-sync-dashboard.mjs --batch-id <id>');
    console.error('   or: node scripts/phase7-sync-dashboard.mjs --phase3 <phase3.json> [--criteria <criteria.json>] [--excel <batch.xlsx>]');
    process.exit(1);
  }

  ensureDataDirs();
  return opts;
}

function readJsonIfExists(path) {
  return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function sheetRowsToObjects(ws) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim()))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

function readWorkbookRows(path, sheetName) {
  if (!path || !existsSync(path)) return [];
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const ws = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
  return sheetRowsToObjects(ws);
}

function loadBatchExcelOverrides(path) {
  const rows = readWorkbookRows(path, '候选人');
  const byVanity = new Map();
  for (const row of rows) {
    const vanity = String(row.Vanity || row.vanity || '').trim();
    if (!vanity) continue;
    byVanity.set(vanity, {
      profile_url: String(row['Profile URL'] || '').trim(),
      connect_status: String(row['Connect状态'] || row['Connect 状态'] || '').trim(),
      current_title: String(row['当前职位'] || '').trim(),
      current_company: String(row['当前公司'] || '').trim(),
      target_experience: String(row['目标公司经历'] || '').trim(),
      hits_summary: String(row['搜索命中'] || '').trim(),
      reasoning: String(row['评分理由'] || '').trim(),
    });
  }
  return byVanity;
}

function profileUrl(candidate, override) {
  return candidate.profile_url
    || override?.profile_url
    || (candidate.vanity ? `https://www.linkedin.com/in/${candidate.vanity}` : '');
}

function parseTier(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 99;
}

function targetCompanies(criteria) {
  const fromHardFilter = (criteria.hard_filters?.any_of_companies || [])
    .map(c => (typeof c === 'string' ? c : c?.name))
    .filter(Boolean);
  const fromTargets = (criteria.target_companies || [])
    .map(c => (typeof c === 'string' ? c : c?.name))
    .filter(Boolean);
  return [...new Set([...fromTargets, ...fromHardFilter])];
}

function targetExperience(candidate, criteria) {
  const override = candidate._excel?.target_experience;
  if (override) return override;

  const targets = targetCompanies(criteria).map(c => c.toLowerCase());
  const positions = candidate.positions || [];
  const matched = positions.filter(p => {
    if (!targets.length) return false;
    const company = String(p.company || '').toLowerCase();
    return targets.some(t => company.includes(t) || t.includes(company));
  });
  const pool = matched.length ? matched : positions.slice(0, 2);
  return pool
    .map(p => `${p.company || ''} | ${p.title || ''} | ${p.startYear || '?'}-${p.endYear || 'now'}`)
    .filter(s => s.replace(/[|?\-\snow]/g, '').trim())
    .join('\n');
}

function hitsSummary(candidate) {
  if (candidate._excel?.hits_summary) return candidate._excel.hits_summary;
  return (candidate.hits || [])
    .map(h => [h.kw, h.strategy, h.company].filter(Boolean).join('@'))
    .filter(Boolean)
    .join(' + ');
}

function mergeListText(existing, current) {
  const parts = String(existing || '')
    .split(/\n|;|\+/)
    .concat(String(current || '').split(/\n|;|\+/))
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].join('\n');
}

function candidateDashboardRow(candidate, criteria, batchId) {
  const override = candidate._excel || {};
  const url = profileUrl(candidate, override);
  const name = candidate.name || `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim();
  const status = override.connect_status || candidate.connect_status || '待确认';
  return {
    '姓名': name,
    'LinkedIn URL': url,
    'tier': candidate.tier ?? '',
    '推荐度': tierToStars(candidate.tier),
    '当前公司 · 职位': [override.current_company || candidate.current_company, override.current_title || candidate.current_title]
      .filter(Boolean)
      .join(' · '),
    '目标经历摘要': targetExperience(candidate, criteria),
    '命中信息': hitsSummary(candidate),
    '首次出现批次': batchId,
    '最近出现批次': batchId,
    '出现次数': 1,
    'Connect 状态': status,
    '邀请发出时间': status === '已发送' ? nowLocalString() : '',
    '接受时间': '',
    'Follow-up 时间': '',
    '备注': candidate.reasoning || override.reasoning || '',
  };
}

function mergeCandidateRows(existing, current) {
  const existingTier = parseTier(existing.tier);
  const currentTier = parseTier(current.tier);
  const next = { ...existing };
  next['姓名'] = current['姓名'] || existing['姓名'];
  next['LinkedIn URL'] = current['LinkedIn URL'] || existing['LinkedIn URL'];
  next['tier'] = Math.min(existingTier, currentTier);
  next['推荐度'] = tierToStars(next['tier']);
  next['当前公司 · 职位'] = current['当前公司 · 职位'] || existing['当前公司 · 职位'];
  next['目标经历摘要'] = current['目标经历摘要'] || existing['目标经历摘要'];
  next['命中信息'] = mergeListText(existing['命中信息'], current['命中信息']);
  next['首次出现批次'] = existing['首次出现批次'] || current['首次出现批次'];
  const sameBatch = String(existing['最近出现批次'] || '') === String(current['最近出现批次'] || '');
  next['最近出现批次'] = current['最近出现批次'];
  next['出现次数'] = Number(existing['出现次数'] || 0) + (sameBatch ? 0 : 1);

  if (ACTIONED_STATUSES.has(current['Connect 状态'])) {
    next['Connect 状态'] = current['Connect 状态'];
    if (current['Connect 状态'] === '已发送' && !existing['邀请发出时间']) {
      next['邀请发出时间'] = current['邀请发出时间'] || nowLocalString();
    }
  } else {
    next['Connect 状态'] = existing['Connect 状态'] || current['Connect 状态'];
  }

  next['接受时间'] = existing['接受时间'] || current['接受时间'];
  next['Follow-up 时间'] = existing['Follow-up 时间'] || current['Follow-up 时间'];
  next['备注'] = mergeListText(existing['备注'], current['备注']);
  return next;
}

function nowLocalString() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function criteriaKeywords(criteria) {
  const sk = criteria.search_keywords || {};
  return [...new Set([
    ...(sk.primary || []),
    ...(sk.secondary || []),
    ...(sk.fallback || []),
  ].filter(Boolean))].join('、');
}

function batchRow(batchId, criteria, phase3, excelPath, candidates) {
  const summary = phase3.summary || {};
  const targets = (criteria.target_companies || [])
    .map(c => (typeof c === 'string' ? c : `${c.name}${c.priority ? `(P${c.priority})` : ''}`))
    .filter(Boolean)
    .join(' + ');
  const sent = candidates.filter(c => ACTIONED_STATUSES.has(c._dashboard_status)).length;
  return {
    'batch_id': batchId,
    '时间': criteria.created_at || summary.generated_at || nowLocalString(),
    '真实课题': criteria.topic_specific || '',
    '目标公司': targets,
    '关键词': criteriaKeywords(criteria),
    '总搜索': summary.total || '',
    '通过筛选': candidates.length,
    '已发 Connect': sent,
    '当批次 Excel 路径': excelPath || '',
  };
}

const CANDIDATE_HEADERS = [
  '姓名', 'LinkedIn URL', 'tier', '推荐度', '当前公司 · 职位', '目标经历摘要', '命中信息',
  '首次出现批次', '最近出现批次', '出现次数', 'Connect 状态', '邀请发出时间', '接受时间',
  'Follow-up 时间', '备注',
];
const BATCH_HEADERS = [
  'batch_id', '时间', '真实课题', '目标公司', '关键词', '总搜索', '通过筛选', '已发 Connect', '当批次 Excel 路径',
];

function objectsToSheet(rows, headers) {
  const aoa = [headers, ...rows.map(row => headers.map(h => row[h] ?? ''))];
  return XLSX.utils.aoa_to_sheet(aoa);
}

function applySheetLayout(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
}

function sortCandidateRows(rows) {
  return rows.sort((a, b) => {
    const recent = String(b['最近出现批次'] || '').localeCompare(String(a['最近出现批次'] || ''));
    if (recent !== 0) return recent;
    return parseTier(a.tier) - parseTier(b.tier);
  });
}

function sortBatchRows(rows) {
  return rows.sort((a, b) => String(b['时间'] || '').localeCompare(String(a['时间'] || '')));
}

function main() {
  const opts = parseArgs();
  const phase3 = readJsonIfExists(opts.phase3);
  const criteria = readJsonIfExists(opts.criteria);
  const batchId = opts.batchId || parseBatchId(opts.phase3) || 'manual';
  const excelOverrides = loadBatchExcelOverrides(opts.excel);

  const passed = (phase3.passed || []).map(candidate => {
    const override = excelOverrides.get(candidate.vanity) || {};
    return {
      ...candidate,
      _excel: override,
      _dashboard_status: override.connect_status || candidate.connect_status || '待确认',
    };
  });

  const existingCandidates = readWorkbookRows(opts.dashboard, '候选人库');
  const existingBatches = readWorkbookRows(opts.dashboard, '批次索引');
  const byUrl = new Map();

  for (const row of existingCandidates) {
    const url = String(row['LinkedIn URL'] || '').trim();
    if (url) byUrl.set(url, row);
  }

  let inserted = 0;
  let updated = 0;
  for (const candidate of passed) {
    const row = candidateDashboardRow(candidate, criteria, batchId);
    if (!row['LinkedIn URL']) continue;
    const existing = byUrl.get(row['LinkedIn URL']);
    if (existing) {
      byUrl.set(row['LinkedIn URL'], mergeCandidateRows(existing, row));
      updated += 1;
    } else {
      byUrl.set(row['LinkedIn URL'], row);
      inserted += 1;
    }
  }

  const batch = batchRow(batchId, criteria, phase3, opts.excel, passed);
  const byBatchId = new Map();
  for (const row of existingBatches) {
    const id = String(row.batch_id || '').trim();
    if (id) byBatchId.set(id, row);
  }
  byBatchId.set(batchId, { ...(byBatchId.get(batchId) || {}), ...batch });

  const candidateRows = sortCandidateRows([...byUrl.values()]);
  const batchRows = sortBatchRows([...byBatchId.values()]);

  const wb = XLSX.utils.book_new();
  const ws1 = objectsToSheet(candidateRows, CANDIDATE_HEADERS);
  applySheetLayout(ws1, [18, 42, 8, 10, 34, 42, 38, 24, 24, 10, 16, 22, 22, 22, 46]);
  const ws2 = objectsToSheet(batchRows, BATCH_HEADERS);
  applySheetLayout(ws2, [28, 24, 52, 40, 52, 10, 10, 12, 60]);

  XLSX.utils.book_append_sheet(wb, ws1, '候选人库');
  XLSX.utils.book_append_sheet(wb, ws2, '批次索引');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(opts.dashboard, Buffer.from(buf));

  console.log('✓ Master Dashboard 已同步');
  console.log(`  dashboard: ${opts.dashboard}`);
  console.log(`  batch_id : ${batchId}`);
  console.log(`  新增 ${inserted} 人 · 更新 ${updated} 人 · 候选人库 ${candidateRows.length} 人`);
}

main();
