#!/usr/bin/env node
/**
 * Schema 一致性检查
 *
 * 检查项：
 *   1. lib/excel-schema.json 中 passed sheet 的 header 数量、顺序与 phase4-export-excel.mjs
 *      实际写出的 header 是否完全一致。
 *   2. column_widths 长度与 columns 数量是否一致。
 *
 * 用法：node scripts/schema-check.mjs
 *      node scripts/schema-check.mjs --quiet   只输出汇总
 *
 * 退出码：0 = 全部一致；1 = 有不一致
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dir, '..');
const QUIET = process.argv.includes('--quiet');

const log = (msg) => { if (!QUIET) console.log(msg); };

let errors = 0;
function fail(msg) { errors++; console.error(`✗ ${msg}`); }
function ok(msg)   { log(`✓ ${msg}`); }

// 1) 加载 schema
const schemaPath = resolve(SKILL_ROOT, 'lib/excel-schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// 2) 从 phase4 源文件抽出 passed sheet 的 header 数组
const phase4Path = resolve(SKILL_ROOT, 'scripts/phase4-export-excel.mjs');
const src = readFileSync(phase4Path, 'utf8');

// 匹配 buildPassedRows 里的 const header = [ ... ];
const headerMatch = src.match(/const\s+header\s*=\s*\[([\s\S]*?)\];/);
if (!headerMatch) {
  fail('phase4: 找不到 buildPassedRows 中的 header 数组');
  process.exit(1);
}
const headerLiteral = headerMatch[1];
const phase4Headers = [...headerLiteral.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);

// 3) 从 schema 抽 header
const schemaHeaders = schema.sheets.passed.columns.map(c => c.header);

// 4) 比对长度
if (phase4Headers.length !== schemaHeaders.length) {
  fail(`列数不一致: phase4=${phase4Headers.length}, schema=${schemaHeaders.length}`);
} else {
  ok(`列数一致: ${phase4Headers.length}`);
}

// 5) 逐列比对
const max = Math.max(phase4Headers.length, schemaHeaders.length);
for (let i = 0; i < max; i++) {
  const a = phase4Headers[i] ?? '(missing)';
  const b = schemaHeaders[i] ?? '(missing)';
  if (a !== b) {
    fail(`列 ${i + 1}: phase4="${a}"  schema="${b}"`);
  }
}
if (errors === 0) ok('所有列名顺序一致');

// 6) column_widths 长度
const widths = schema.sheets.passed.column_widths || [];
if (widths.length !== schemaHeaders.length) {
  fail(`column_widths 长度=${widths.length} 不等于列数=${schemaHeaders.length}`);
} else {
  ok(`column_widths 长度匹配: ${widths.length}`);
}

// 7) phase4 中 applyColumnWidths 调用的数组长度
const widthMatch = src.match(/applyColumnWidths\(ws1,\s*\[([\s\S]*?)\]\)/);
if (widthMatch) {
  const phase4Widths = widthMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  if (phase4Widths.length !== schemaHeaders.length) {
    fail(`phase4 applyColumnWidths 长度=${phase4Widths.length} 不等于列数=${schemaHeaders.length}`);
  } else {
    ok(`phase4 applyColumnWidths 长度匹配`);
  }
}

console.log('');
if (errors === 0) {
  console.log('schema-check: PASS');
  process.exit(0);
} else {
  console.error(`schema-check: FAIL (${errors} 项不一致)`);
  process.exit(1);
}
