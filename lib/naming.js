/**
 * batch_id 生成与解析的单一来源
 *
 * 标准格式：search_<YYYYMMDD>_<HHMM>[_<LABEL>]
 *   示例：search_20260530_1314
 *         search_20260530_1314_BEOL
 *
 * 文件名约定：linkedin_<batchId>.<ext>
 *   示例：linkedin_search_20260530_1314.xlsx
 *         linkedin_search_20260530_1314-review.html
 *         phase3_search_20260530_1314.json
 *         decisions_search_20260530_1314.json
 *
 * 所有 Phase 脚本必须用 buildBatchId() 生成 ID，不得自造时间戳格式。
 */

/** label 必须是 [A-Za-z0-9_]+，长度 ≤ 32，否则报错 */
function validateLabel(label) {
  if (!label) return null;
  if (!/^[A-Za-z0-9_]{1,32}$/.test(label)) {
    throw new Error(`invalid batch label "${label}" — 只允许字母数字下划线，≤32 字符`);
  }
  return label;
}

/**
 * 生成 batch_id
 * @param {Date}   [date=now] 时间，默认当前
 * @param {string} [label]    可选标签（如 BEOL、TSE）
 */
export function buildBatchId(date = new Date(), label = null) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const stem = `search_${yyyy}${mm}${dd}_${hh}${mi}`;
  const safe = validateLabel(label);
  return safe ? `${stem}_${safe}` : stem;
}

/**
 * 从文件名反向解析 batch_id（去掉 linkedin_ / phase3_ / decisions_ / raw_ 前缀和扩展名）
 * 返回 null 表示不是合法的 batch 文件
 */
export function parseBatchId(filename) {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.(xlsx|json|html)$/, '');
  const m = base.match(/^(?:linkedin|phase3|decisions|raw)_(search_\d{8}_\d{4}(?:_[A-Za-z0-9_]+)?)(?:-review)?$/);
  return m ? m[1] : null;
}

/** batch_id 自身是否合法 */
export function isValidBatchId(id) {
  return /^search_\d{8}_\d{4}(?:_[A-Za-z0-9_]{1,32})?$/.test(id);
}
