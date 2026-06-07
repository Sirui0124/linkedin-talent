#!/usr/bin/env node
/**
 * Phase 4: Scored results → Excel (.xlsx) + connect messages + Review HTML
 *
 * Usage:
 *   node phase4-export-excel.mjs --batch-id <id>
 *     # 自动按 lib/paths.js 解析输入输出
 *
 *   显式参数（高级用法）:
 *   node phase4-export-excel.mjs \
 *     --input    data/exports/phase3_<id>.json \
 *     --criteria data/criteria/<id>.json \
 *     [--output  data/batches/linkedin_<id>.xlsx] \
 *     [--sender "Zadie"] [--rate "$300-800/hr"] [--company "Funda.ai"]
 *     [--topic "<研究课题>"]
 *
 * ── 输出 ─────────────────────────────────────────────────────────────────
 *   1. <output>.xlsx                Excel 三 Sheet：候选人 / 淘汰名单 / 统计
 *   2. 固定 Review Dashboard         localhost 打开模板，并自动载入当批 Excel
 *   3. (criteria/decisions 等保持原位，本脚本不动)
 *
 * ── Excel 列契约 ──────────────────────────────────────────────────────────
 *   严格按 lib/excel-schema.json 的 sheets.passed.columns 输出 22 列。
 *   schema-check.mjs 会校验源代码 header 与 schema 一致；改 header 必须同步改 schema。
 *
 * ── 话术渲染规则（buildConnectMsg）────────────────────────────────────────
 *   所有变量从 lib/connect-templates.json 的 sender + project_config 读取，
 *   通过 loadConnectDefaults() 一次性加载，--sender/--rate/--company/--topic 仅作覆盖。
 *
 *   - 模板：templates[chosen_type].connect_message（type1_friendly / type2_direct / type3_detailed_inmail）
 *   - 长度：type1/type2 严格 ≤ 290 字符（LinkedIn 上限留 20 字符余量）；type3 无限制
 *   - 变量：{firstName}, {senderName}, {company}, {topic_obfuscated},
 *           {topic_label}, {rate_range}, {expertise}, {highlight}
 *   - {highlight} = phase3 输出的 highlight_for_outreach（不再让 LLM 重新生成）
 *   - 候选人姓名/headline 含中文 → 走 connect-templates.json 的 language_rules.use_chinese_when
 *   - Profile 异常 (pending) → 用 headline 兜底，状态列标 "待人工核验"
 *
 * ── 实现警告 ──────────────────────────────────────────────────────────────
 *   ⚠️ xlsx 写文件必须用 XLSX.write({type:'buffer'}) + fs.writeFileSync。
 *      不能用 XLSX.writeFile — ESM 环境下 _fs 未定义会爆 write_dl 错误。
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { createRequire } from 'module';
import {
  SKILL_ROOT, criteriaPath, phase3JsonPath, batchExcelPath,
  ensureDataDirs,
} from '../lib/paths.js';
import { isValidBatchId, buildBatchId, parseBatchId } from '../lib/naming.js';

// xlsx: 用 buffer 方式写，避免 ESM 下 writeFile/_fs 问题
// 优先 skill 本地 node_modules → 用户全局；找不到给出清晰提示
function loadXlsx() {
  const localPath = resolve(SKILL_ROOT, 'node_modules/xlsx/xlsx.mjs');
  if (existsSync(localPath)) return import(localPath);
  // 兜底：尝试通过 require resolve（处理 npm link / 全局安装）
  try {
    const require = createRequire(import.meta.url);
    const cjsPath = require.resolve('xlsx');
    return import(cjsPath);
  } catch {
    console.error('[error] xlsx 依赖未安装。请在 skill 根目录运行:');
    console.error(`  cd ${SKILL_ROOT} && npm install`);
    process.exit(1);
  }
}
const XLSX = await loadXlsx();

// ── 默认 sender / project 配置（从 connect-templates.json 读取）────────────────
function loadConnectDefaults() {
  const tplPath = resolve(SKILL_ROOT, 'lib/connect-templates.json');
  if (!existsSync(tplPath)) {
    console.error(`[error] 配置缺失: ${tplPath}`);
    process.exit(1);
  }
  const tpl = JSON.parse(readFileSync(tplPath, 'utf8'));
  const senderKey = tpl.project_config?.sender_profile_key || 'Yujia';
  const senderProfile = tpl.sender_profiles?.[senderKey] || {};
  return {
    sender: senderProfile.name || tpl.sender?.name || '',
    company: tpl.sender?.company || '',
    rate: tpl.project_config?.rate_range || '',
    topic: tpl.project_config?.topic_obfuscated || tpl.project_config?.topic_specific || '',
    templateType: tpl.project_config?.template_type || 'type1_friendly',
    tplTemplates: tpl.templates || {},
  };
}

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const defaults = loadConnectDefaults();
  const args = process.argv.slice(2);
  const opts = {
    batchId: null,
    input: null, criteria: null, output: null,
    sender: defaults.sender, rate: defaults.rate,
    company: defaults.company, topic: defaults.topic,
    templateType: defaults.templateType,
    tplTemplates: defaults.tplTemplates,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id') opts.batchId  = args[++i];
    if (args[i] === '--input')    opts.input    = resolve(args[++i]);
    if (args[i] === '--criteria') opts.criteria = resolve(args[++i]);
    if (args[i] === '--output')   opts.output   = resolve(args[++i]);
    if (args[i] === '--sender')   opts.sender   = args[++i];
    if (args[i] === '--rate')     opts.rate     = args[++i];
    if (args[i] === '--company')  opts.company  = args[++i];
    if (args[i] === '--topic')    opts.topic    = args[++i];
    if (args[i] === '--template') opts.templateType = args[++i];
  }
  // 通过 batch-id 自动展开
  if (opts.batchId) {
    if (!isValidBatchId(opts.batchId)) {
      console.error(`[error] 非法 batch-id: ${opts.batchId}`);
      process.exit(1);
    }
    opts.input    ??= phase3JsonPath(opts.batchId);
    opts.criteria ??= criteriaPath(opts.batchId);
    opts.output   ??= batchExcelPath(opts.batchId);
  }
  if (!opts.input) {
    console.error('Usage: node phase4-export-excel.mjs --batch-id <id>');
    console.error('   or: node phase4-export-excel.mjs --input <phase3.json> --criteria <criteria.json>');
    process.exit(1);
  }
  if (!opts.output) {
    // 没 batch-id 也没 output → 现场生成一个 batch-id
    opts.batchId = buildBatchId();
    opts.output = batchExcelPath(opts.batchId);
  } else if (!opts.batchId) {
    // 从 output 文件名反推
    opts.batchId = parseBatchId(opts.output) || buildBatchId();
  }
  // sender is always required; rate/topic/company only needed for type2/type3
  const alwaysRequired = ['sender'];
  const paidRequired = ['company', 'rate', 'topic'];
  const isPaid = !opts.templateType || opts.templateType !== 'type1_friendly';
  const required = isPaid ? [...alwaysRequired, ...paidRequired] : alwaysRequired;
  for (const k of required) {
    if (!opts[k]) {
      console.error(`[error] ${k} 为空。请在 lib/connect-templates.json 的 project_config 里填好，或用 --${k} 参数传入`);
      process.exit(1);
    }
  }
  ensureDataDirs();
  return opts;
}

// ── Connect message ───────────────────────────────────────────────────────────
function buildConnectMsg(c, opts) {
  const firstName = c.first_name || c.name?.split(' ')[0] || c.name || 'there';
  const hl = c.highlight_for_outreach || '';
  const tplType = opts.templateType || 'type1_friendly';
  const tpl = (opts.tplTemplates || {})[tplType];
  if (!tpl?.connect_message) {
    return `Hi ${firstName},${hl ? ' ' + hl : ''} Would love to connect!`;
  }
  const msg = tpl.connect_message
    .replace(/{firstName}/g, firstName)
    .replace(/{highlight}/g, hl)
    .replace(/{senderName}/g, opts.sender || '')
    .replace(/{company}/g, opts.company || '')
    .replace(/{topic_obfuscated}/g, opts.topic || '')
    .replace(/{rate_range}/g, opts.rate || '')
    .replace(/  +/g, ' ')
    .trim();
  if (tplType !== 'type3_detailed_inmail' && msg.length > 290) {
    return `Hi ${firstName},${hl ? ' ' + hl : ''} Would love to connect!`;
  }
  return msg;
}

// ── Sheet 1: Passed candidates ────────────────────────────────────────────────
function buildPassedRows(passed, opts, criteria) {
  const TARGET_COS = (criteria?.hard_filters?.any_of_companies || ['tsmc', 'intel', '台积电', '英特尔'])
    .map(c => (typeof c === 'string' ? c : c?.name || '').toLowerCase())
    .filter(Boolean);

  function targetExp(positions) {
    return (positions || [])
      .filter(p => TARGET_COS.some(c => (p.company || '').toLowerCase().includes(c)))
      .map(p => `${p.company} | ${p.title} | ${p.startYear || '?'}-${p.endYear || 'now'}`)
      .join('\n') || '—';
  }
  function otherExp(positions) {
    return (positions || [])
      .filter(p => !TARGET_COS.some(c => (p.company || '').toLowerCase().includes(c)))
      .slice(0, 3)
      .map(p => `${p.company} | ${p.title} | ${p.startYear || '?'}-${p.endYear || 'now'}`)
      .join('\n') || '—';
  }
  function fullExp(positions) {
    return (positions || [])
      .map(p => [p.company, p.title, `${p.startYear || '?'}-${p.endYear || 'now'}`, p.desc || '']
        .map(v => String(v || '').replace(/\s+/g, ' ').trim())
        .join(' | '))
      .join('\n') || '—';
  }
  function edu(educations) {
    return (educations || []).map(e => [e.school, e.degree, e.field].filter(Boolean).join(' · ')).join('\n') || '—';
  }
  function dimScores(sb) {
    const labels = {
      company_match: '公司',
      topic_depth: '岗位',
      seniority_focus: '目标岗时长',
      target_role_duration: '目标岗时长',
      target_company_role_duration: '目标岗时长',
      bonus: '加分',
    };
    return (sb || []).map(d => `${labels[d.key] || d.key}:${d.score}`).join(' / ');
  }
  function tierLabel(t) { return t === 1 ? '⭐⭐⭐' : t === 2 ? '⭐⭐' : t === 3 ? '⭐' : t === 0 ? '排除' : '-'; }

  const header = [
    '序号', 'Tier', '总分', '分项评分', '姓名', '当前职位', '当前公司',
    '目标公司经历', '其他经历', '完整经历', '学历', '地点', '评分理由',
    'matched_signals', 'missed_signals', 'highlight_for_outreach',
    'Connect 话术', 'Profile URL', 'Vanity', 'URN',
    '搜索命中', '评分方式', 'Connect状态',
  ];

  const rows = [header];
  passed.forEach((c, i) => {
    const positions = c.positions || (c.experience_history
      ? c.experience_history.split('; ').map(s => { const [company, title, yr] = s.split(' | '); return { company, title }; })
      : []);
    rows.push([
      i + 1,
      `${c.tier ?? '?'} ${tierLabel(c.tier)}`,
      c.score ?? '',
      dimScores(c.scores_breakdown),
      c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
      c.current_title || positions[0]?.title || '',
      c.current_company || positions[0]?.company || '',
      targetExp(positions),
      otherExp(positions),
      fullExp(positions),
      edu(c.educations || []),
      c.location || '',
      c.reasoning || '',
      (c.matched_signals || []).join('; '),
      (c.missed_signals || []).join('; '),
      c.highlight_for_outreach || '',
      buildConnectMsg(c, opts),
      c.profile_url || (c.vanity ? `https://www.linkedin.com/in/${c.vanity}` : ''),
      c.vanity || '',
      c.urn || '',
      (c.hits || []).map(h => `${h.kw}@${h.strategy || ''}`).join(' + '),
      c.scored_by || 'rule',
      c.connect_status || '待确认',
    ]);
  });
  return rows;
}

// ── Sheet 2: Failed candidates ────────────────────────────────────────────────
function buildFailedRows(failed) {
  const header = ['姓名', 'Headline', 'Vanity', '淘汰原因'];
  return [header, ...failed.map(c => [c.name || '', c.headline || '', c.vanity || '', c.reason || ''])];
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function applyColumnWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}
function freezeTopRow(ws) {
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
}

async function waitForReviewServer(port) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let i = 0; i < 20; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function openReviewDashboard(excelPath) {
  const port = Number(process.env.LINKEDIN_TALENT_REVIEW_PORT || 45217);
  const serverPath = resolve(SKILL_ROOT, 'scripts/review-server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    cwd: SKILL_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LINKEDIN_TALENT_REVIEW_PORT: String(port) },
  });
  child.unref();
  await waitForReviewServer(port);
  const excelUrl = `/api/excel?path=${encodeURIComponent(resolve(excelPath))}`;
  const name = encodeURIComponent(excelPath.replace(/^.*[\\/]/, ''));
  const url = `http://127.0.0.1:${port}/review-dashboard.html?excel=${encodeURIComponent(excelUrl)}&name=${name}`;
  execSync(`open "${url}"`);
  return url;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  const phase3 = JSON.parse(readFileSync(opts.input, 'utf8'));
  const passed = phase3.passed || [];
  const failed = phase3.failed || [];
  const summary = phase3.summary || {};

  const criteria = opts.criteria && existsSync(opts.criteria)
    ? JSON.parse(readFileSync(opts.criteria, 'utf8'))
    : {};

  console.log(`passed: ${passed.length}  failed: ${failed.length}`);

  // Sheet 1
  const passedRows = buildPassedRows(passed, opts, criteria);
  const ws1 = XLSX.utils.aoa_to_sheet(passedRows);
  applyColumnWidths(ws1, [5, 8, 6, 28, 18, 22, 16, 30, 30, 55, 25, 14, 35, 30, 30, 40, 60, 45, 25, 40, 30, 8, 8]);
  freezeTopRow(ws1);

  // Sheet 2
  const failedRows = buildFailedRows(failed);
  const ws2 = XLSX.utils.aoa_to_sheet(failedRows);
  applyColumnWidths(ws2, [18, 40, 25, 30]);

  // Sheet 3: 统计
  const t1 = passed.filter(c => c.tier === 1).length;
  const t2 = passed.filter(c => c.tier === 2).length;
  const t3 = passed.filter(c => c.tier === 3).length;
  const statsRows = [
    ['指标', '数值'],
    ['总召回', summary.total || '—'],
    ['预筛丢弃', summary.pre_dropped || '—'],
    ['实际拉取 Profile', summary.profile_fetched || '—'],
    ['L2 通过', passed.length],
    ['L2 失败', failed.length],
    ['Tier 1 (⭐⭐⭐)', t1],
    ['Tier 2 (⭐⭐)', t2],
    ['Tier 3 (⭐)', t3],
    ['生成时间', new Date().toLocaleString('zh-CN')],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(statsRows);
  applyColumnWidths(ws3, [22, 14]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, '候选人');
  XLSX.utils.book_append_sheet(wb, ws2, '淘汰名单');
  XLSX.utils.book_append_sheet(wb, ws3, '统计');

  // ⚠️ 必须用 buffer 写，不能用 XLSX.writeFile（ESM 下 _fs=undefined 会 crash）
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(opts.output, Buffer.from(buf));

  // ── Open fixed dashboard template ─────────────────────────────────────────
  const tplPath = resolve(SKILL_ROOT, 'templates/review-dashboard.html');
  if (!existsSync(tplPath)) {
    console.error(`[error] Dashboard 模板不存在: ${tplPath}`);
    process.exit(1);
  }
  console.log(`✓ Dashboard  : ${tplPath}`);
  const dashboardUrl = await openReviewDashboard(opts.output);

  console.log(`✓ Excel      : ${opts.output}`);
  console.log(`✓ Review URL : ${dashboardUrl}`);
  console.log(`  候选人 ${passed.length} 行 (T1:${t1} T2:${t2} T3:${t3}) | 淘汰 ${failed.length} 行`);
}

main().catch(e => { console.error(e); process.exit(1); });
