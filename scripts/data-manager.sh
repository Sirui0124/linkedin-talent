#!/usr/bin/env bash
#
# LinkedIn Talent Data Manager
# 管理 ~/.linkedin-talent/ 下的批次文件：列出、归档、命名检查
#
# 数据布局（与 lib/paths.js 一致）：
#   ~/.linkedin-talent/
#     ├── dashboard.xlsx
#     ├── batches/   linkedin_<batchId>.xlsx
#     ├── batches/   linkedin_<batchId>-review.html
#     ├── criteria/  <batchId>.json
#     ├── exports/   raw_<batchId>.json / phase3_<batchId>.json
#     ├── decisions/ decisions_<batchId>.json
#     └── archive/

set -euo pipefail

DATA_HOME="${LINKEDIN_TALENT_HOME:-$HOME/.linkedin-talent}"
BATCHES_DIR="$DATA_HOME/batches"
DECISIONS_DIR="$DATA_HOME/decisions"
ARCHIVE_DIR="$DATA_HOME/archive"

# Color
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

ensure_dirs() {
    mkdir -p "$BATCHES_DIR" "$DECISIONS_DIR" "$ARCHIVE_DIR"
}

# 从 linkedin_<batchId>.xlsx 提取 batchId
extract_batch_id() {
    local filename
    filename="$(basename "$1")"
    if [[ $filename =~ ^linkedin_(search_[0-9]{8}_[0-9]{4}(_[A-Za-z0-9_]+)?)\.xlsx$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi
    echo ""
}

# Excel 行数估算（解析 sharedStrings.xml）
get_file_size() {
    local file="$1"
    [[ -f "$file" ]] || { echo "0"; return; }
    if [[ "$file" == *.xlsx ]]; then
        local count
        count=$(unzip -p "$file" xl/sharedStrings.xml 2>/dev/null \
                | grep -o '<si>' | wc -l | tr -d ' ' || echo "0")
        [[ $count -gt 0 ]] && echo "~$count" || echo "?"
    else
        echo "?"
    fi
}

list_batches() {
    ensure_dirs
    log "Batches under $BATCHES_DIR:"
    echo ""
    printf "| %-38s | %-10s | %-6s | %-9s | %-10s |\n" \
           "Batch ID" "Date" "Size" "Decision" "Status"
    printf "|%s|%s|%s|%s|%s|\n" \
           "----------------------------------------" \
           "------------" "--------" "-----------" "------------"

    shopt -s nullglob
    for file in "$BATCHES_DIR"/linkedin_*.xlsx; do
        local basename batch_id date size decision status
        basename="$(basename "$file")"
        batch_id="$(extract_batch_id "$file")"
        if [[ -z "$batch_id" ]]; then
            warn "Skipping non-compliant: $basename"
            continue
        fi
        date=$(stat -f "%Sm" -t "%Y-%m-%d" "$file" 2>/dev/null \
              || stat -c "%y" "$file" 2>/dev/null | cut -d' ' -f1 \
              || echo "unknown")
        size=$(get_file_size "$file")
        decision="-"
        status="Draft"
        if [[ -f "$DECISIONS_DIR/decisions_${batch_id}.json" ]]; then
            decision="yes"
            status="Ready"
        fi
        printf "| %-38s | %-10s | %-6s | %-9s | %-10s |\n" \
               "$batch_id" "$date" "$size" "$decision" "$status"
    done
    shopt -u nullglob
    echo ""
}

archive_old() {
    ensure_dirs
    local days="${1:-90}"
    log "Archiving files older than $days days into $ARCHIVE_DIR..."
    find "$BATCHES_DIR"   -name "*.xlsx" -mtime +$days -exec mv {} "$ARCHIVE_DIR/" \; 2>/dev/null || true
    find "$BATCHES_DIR"   -name "*.html" -mtime +$days -exec mv {} "$ARCHIVE_DIR/" \; 2>/dev/null || true
    find "$DECISIONS_DIR" -name "*.json" -mtime +$days -exec mv {} "$ARCHIVE_DIR/" \; 2>/dev/null || true
    log "Done"
}

check_naming() {
    ensure_dirs
    log "Checking file naming compliance under $BATCHES_DIR..."
    local issues=0
    shopt -s nullglob
    for file in "$BATCHES_DIR"/*; do
        local basename
        basename="$(basename "$file")"
        if [[ ! $basename =~ ^linkedin_search_[0-9]{8}_[0-9]{4}(_[A-Za-z0-9_]+)?(\.xlsx|-review\.html)$ ]]; then
            warn "Non-compliant naming: $basename"
            ((issues++)) || true
        fi
    done
    shopt -u nullglob
    if [[ $issues -eq 0 ]]; then
        log "All files follow naming conventions"
    else
        warn "Found $issues naming issues"
    fi
}

case "${1:-list}" in
    list|ls)   list_batches ;;
    archive)   archive_old "${2:-90}" ;;
    check)     check_naming ;;
    help|-h|--help)
        cat <<EOF
LinkedIn Talent Data Manager

Usage: $0 [command]

Commands:
  list     List all batches with decision/status (default)
  archive  Archive files older than N days (default 90)
  check    Verify file naming compliance
  help     Show this help

Data home: $DATA_HOME (override with LINKEDIN_TALENT_HOME)
EOF
        ;;
    *) error "Unknown command: $1"; echo "Use '$0 help' for usage"; exit 1 ;;
esac
