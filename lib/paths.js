/**
 * 路径与文件名单一来源
 *
 * 数据布局（skill 本地 data 目录，不纳入 Git 同步）：
 *   <skill_root>/data/
 *     ├── dashboard.xlsx                              ← master dashboard（跨批次累计）
 *     ├── strategies/ <role-or-topic>.json            ← 用户保存的岗位/课题策略
 *     ├── batches/   linkedin_<batchId>.xlsx          ← 单批次结果 Excel
 *     ├── criteria/  <batchId>.json                   ← Phase 1 解析后的详细搜索策略（运行时）
 *     ├── exports/   raw_<batchId>.json               ← Phase 2 召回原始数据
 *     ├── exports/   phase3_<batchId>.json            ← Phase 3 评分结果
 *     ├── decisions/ decisions_<batchId>.json         ← Phase 5 用户确认结果
 *     └── archive/   <旧文件>
 *
 * strategies / criteria / exports / batches 都属于用户数据，随本地安装保留，
 * 不纳入 Git 同步。代码更新只能读取和兼容这些文件，不得覆盖用户策略。
 *
 * 所有 Phase 脚本必须从此处取路径，不得硬编码。
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dir = dirname(fileURLToPath(import.meta.url));

export const SKILL_ROOT = resolve(__dir, '..');
export const DATA_HOME = resolve(process.env.LINKEDIN_TALENT_HOME || resolve(SKILL_ROOT, 'data'));

export const STRATEGIES_DIR = resolve(DATA_HOME, 'strategies');
export const BATCHES_DIR   = resolve(DATA_HOME, 'batches');
export const CRITERIA_DIR  = resolve(DATA_HOME, 'criteria');
export const EXPORTS_DIR   = resolve(DATA_HOME, 'exports');
export const DECISIONS_DIR = resolve(DATA_HOME, 'decisions');
export const ARCHIVE_DIR   = resolve(DATA_HOME, 'archive');

export const DASHBOARD_PATH = resolve(DATA_HOME, 'dashboard.xlsx');

/** 单批次 Excel 路径 */
export function batchExcelPath(batchId) {
  return resolve(BATCHES_DIR, `linkedin_${batchId}.xlsx`);
}

/** 用户保存的岗位/课题策略 JSON */
export function savedStrategyPath(name) {
  return resolve(STRATEGIES_DIR, `${name}.json`);
}

/** Phase 1 解析后的详细搜索策略 JSON（每批次运行时策略） */
export function criteriaPath(batchId) {
  return resolve(CRITERIA_DIR, `${batchId}.json`);
}

/** Phase 2 召回的原始候选人 JSON */
export function rawCandidatesPath(batchId) {
  return resolve(EXPORTS_DIR, `raw_${batchId}.json`);
}

/** Phase 3 评分结果 JSON */
export function phase3JsonPath(batchId) {
  return resolve(EXPORTS_DIR, `phase3_${batchId}.json`);
}

/** Phase 5 用户确认 JSON */
export function decisionsPath(batchId) {
  return resolve(DECISIONS_DIR, `decisions_${batchId}.json`);
}

/** 首次运行时建好所有目录 */
export function ensureDataDirs() {
  for (const d of [DATA_HOME, STRATEGIES_DIR, BATCHES_DIR, CRITERIA_DIR, EXPORTS_DIR, DECISIONS_DIR, ARCHIVE_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
