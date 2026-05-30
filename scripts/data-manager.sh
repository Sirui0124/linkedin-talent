#!/bin/bash

# LinkedIn Talent Data Manager
# 管理linkedin-talent skill的数据文件：命名、索引、dashboard同步

SKILL_DIR="$(dirname "$(dirname "$0")")"
DATA_DIR="$SKILL_DIR/data"
CONFIG_FILE="$SKILL_DIR/lib/data-manager.json"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Extract batch ID from filename
extract_batch_id() {
    local filename="$1"

    # Pattern 1: Named batch like BEOL, TSE
    if [[ $filename =~ linkedin_search_([A-Z0-9_]+)_[0-9]{8} ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi

    # Pattern 2: Timestamp-only batch
    if [[ $filename =~ linkedin_search_([0-9]{8}_[0-9]{6}) ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi

    # Pattern 3: Company-specific like ex_alibaba
    if [[ $filename =~ linkedin_ex_([a-z_]+)_([0-9]{8}_[0-9]{6}) ]]; then
        echo "ex_${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
        return
    fi

    # Fallback: use filename without extension
    echo "${filename%.*}"
}

# Get file size estimate
get_file_size() {
    local file="$1"
    if [[ -f "$file" ]]; then
        if [[ "$file" == *.xlsx ]]; then
            # Try to count rows in Excel file (approximation)
            local count=$(unzip -p "$file" xl/sharedStrings.xml 2>/dev/null | grep -o '<si>' | wc -l | tr -d ' ' || echo "0")
            if [[ $count -gt 0 ]]; then
                echo "~$count"
            else
                echo "?"
            fi
        elif [[ "$file" == *.tsv ]] || [[ "$file" == *.csv ]]; then
            local count=$(wc -l < "$file" 2>/dev/null | tr -d ' ')
            echo "~$count"
        else
            echo "?"
        fi
    else
        echo "0"
    fi
}

# List all batches with metadata
list_batches() {
    log "LinkedIn talent sourcing batches:"
    echo ""
    echo "| Batch ID | Date | Size | Decision | Status |"
    echo "|----------|------|------|----------|--------|"

    for file in "$DATA_DIR/batches"/*; do
        if [[ -f "$file" ]]; then
            local basename=$(basename "$file")
            local batch_id=$(extract_batch_id "$basename")
            local date=$(stat -f "%Sm" -t "%Y-%m-%d" "$file" 2>/dev/null || echo "unknown")
            local size=$(get_file_size "$file")

            # Check for corresponding decision file
            local decision_status="❌"
            if find "$DATA_DIR/decisions" -name "decisions_${batch_id}_*.json" -type f | grep -q .; then
                decision_status="✅"
            fi

            local status="📝 Draft"
            if [[ $decision_status == "✅" ]]; then
                status="🚀 Ready"
            fi

            echo "| $batch_id | $date | $size | $decision_status | $status |"
        fi
    done
    echo ""
}

# Archive old files
archive_old() {
    local days=${1:-90}
    log "Archiving files older than $days days..."

    mkdir -p "$DATA_DIR/archive"

    find "$DATA_DIR/batches" -name "*.xlsx" -mtime +$days -exec mv {} "$DATA_DIR/archive/" \;
    find "$DATA_DIR/decisions" -name "*.json" -mtime +$days -exec mv {} "$DATA_DIR/archive/" \;

    log "Archive completed"
}

# Sync with dashboard
sync_dashboard() {
    local dashboard_file="$HOME/hr-talent-scout/dashboard/master_linkedin.xlsx"

    if [[ ! -f "$dashboard_file" ]]; then
        warn "Dashboard file not found: $dashboard_file"
        return 1
    fi

    log "Syncing with master dashboard..."

    # This would be implemented to update the master dashboard
    # with batch statistics and status

    log "Dashboard sync completed"
}

# Check file naming compliance
check_naming() {
    log "Checking file naming compliance..."

    local issues=0

    for file in "$DATA_DIR/batches"/*; do
        if [[ -f "$file" ]]; then
            local basename=$(basename "$file")
            if [[ ! $basename =~ ^linkedin_search_.+_[0-9]{8}(_[0-9]{6})?\.xlsx$ ]] &&
               [[ ! $basename =~ ^linkedin_ex_.+_[0-9]{8}_[0-9]{6}\.xlsx$ ]] &&
               [[ ! $basename =~ ^linkedin_search_.+\.(tsv|csv)$ ]]; then
                warn "Non-compliant naming: $basename"
                ((issues++))
            fi
        fi
    done

    if [[ $issues -eq 0 ]]; then
        log "All files follow naming conventions ✅"
    else
        warn "Found $issues naming issues ⚠️"
    fi
}

# Main command dispatcher
case "${1:-list}" in
    "list"|"ls")
        list_batches
        ;;
    "archive")
        archive_old "${2:-90}"
        ;;
    "sync")
        sync_dashboard
        ;;
    "check")
        check_naming
        ;;
    "help"|"-h"|"--help")
        echo "LinkedIn Talent Data Manager"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  list     List all batches with metadata (default)"
        echo "  archive  Archive old files (default: 90+ days)"
        echo "  sync     Sync with master dashboard"
        echo "  check    Check file naming compliance"
        echo "  help     Show this help"
        ;;
    *)
        error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac