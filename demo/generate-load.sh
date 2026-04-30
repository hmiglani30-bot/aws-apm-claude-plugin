#!/usr/bin/env bash
# =============================================================================
# generate-load.sh — Load generator for the Pet Clinic API demo
#
# Sends mixed GET/POST requests to populate CloudWatch metrics, X-Ray traces,
# and CloudWatch Logs with realistic traffic patterns.
#
# Usage:
#   ./generate-load.sh <API_URL>
#   ./generate-load.sh <API_URL> 20       # run for 20 minutes
#   ./generate-load.sh <API_URL> 10 0.5   # 10 minutes, 0.5s between requests
# =============================================================================
set -euo pipefail

# --- Arguments ---
API_URL="${1:?Usage: $0 <API_GATEWAY_URL> [duration_minutes] [delay_seconds]}"
DURATION_MINUTES="${2:-10}"
DELAY_SECONDS="${3:-0.3}"

# Strip trailing slash from URL
API_URL="${API_URL%/}"

# --- Counters ---
TOTAL=0
SUCCESS=0
ERRORS=0
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_MINUTES * 60))
LAST_REPORT=$START_TIME

# --- Pet names and species for POST requests ---
PET_NAMES=("Luna" "Max" "Bella" "Charlie" "Milo" "Daisy" "Rocky" "Coco" "Sadie" "Tucker"
           "Bailey" "Duke" "Penny" "Bear" "Maggie" "Zeus" "Rosie" "Finn" "Ruby" "Oscar")
SPECIES=("dog" "cat" "bird" "fish" "hamster" "rabbit" "turtle" "gecko")
OWNERS=("Frank" "Grace" "Hank" "Iris" "Jack" "Karen" "Leo" "Mona" "Nick" "Olivia")

echo "=============================================="
echo " Pet Clinic API — Load Generator"
echo "=============================================="
echo " API URL:     ${API_URL}"
echo " Duration:    ${DURATION_MINUTES} minutes"
echo " Delay:       ${DELAY_SECONDS}s between requests"
echo " Started at:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="
echo ""

# --- Helper: print progress report ---
print_report() {
    local now=$(date +%s)
    local elapsed=$(( now - START_TIME ))
    local remaining=$(( END_TIME - now ))
    local error_rate=0
    if [ "$TOTAL" -gt 0 ]; then
        error_rate=$(awk "BEGIN {printf \"%.1f\", ($ERRORS / $TOTAL) * 100}")
    fi
    echo "[$(date -u '+%H:%M:%S')] ${elapsed}s elapsed | ${TOTAL} requests | ${SUCCESS} ok | ${ERRORS} errors (${error_rate}%) | ${remaining}s remaining"
}

# --- Main loop ---
while [ "$(date +%s)" -lt "$END_TIME" ]; do
    # Pick a random request type with realistic distribution:
    #   60% GET /pets (list)
    #   25% GET /pets/{id} (single)
    #   15% POST /pets (create)
    RAND=$((RANDOM % 100))

    if [ "$RAND" -lt 60 ]; then
        # GET /pets — list all
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            "${API_URL}/pets" 2>/dev/null) || HTTP_CODE="000"

    elif [ "$RAND" -lt 85 ]; then
        # GET /pets/{id} — get single pet (mix of valid and invalid IDs)
        PET_ID=$((RANDOM % 8 + 1))  # IDs 1-8, some will 404
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            "${API_URL}/pets/${PET_ID}" 2>/dev/null) || HTTP_CODE="000"

    else
        # POST /pets — create new pet
        NAME="${PET_NAMES[$((RANDOM % ${#PET_NAMES[@]}))]}"
        SPECIES_PICK="${SPECIES[$((RANDOM % ${#SPECIES[@]}))]}"
        OWNER="${OWNERS[$((RANDOM % ${#OWNERS[@]}))]}"
        AGE=$((RANDOM % 15 + 1))

        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 10 \
            -X POST \
            -H "Content-Type: application/json" \
            -d "{\"name\":\"${NAME}\",\"species\":\"${SPECIES_PICK}\",\"age\":${AGE},\"owner\":\"${OWNER}\"}" \
            "${API_URL}/pets" 2>/dev/null) || HTTP_CODE="000"
    fi

    TOTAL=$((TOTAL + 1))

    if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 400 ] 2>/dev/null; then
        SUCCESS=$((SUCCESS + 1))
    else
        ERRORS=$((ERRORS + 1))
    fi

    # --- Print progress every 30 seconds ---
    NOW=$(date +%s)
    if [ $((NOW - LAST_REPORT)) -ge 30 ]; then
        print_report
        LAST_REPORT=$NOW
    fi

    # --- Delay between requests ---
    sleep "$DELAY_SECONDS"
done

# --- Final report ---
echo ""
echo "=============================================="
echo " Load Generation Complete"
echo "=============================================="
print_report
echo ""
echo "Next steps:"
echo "  1. Wait 2-3 minutes for metrics to propagate to CloudWatch"
echo "  2. Check the dashboard:  aws cloudformation describe-stacks --stack-name apm-demo --query 'Stacks[0].Outputs'"
echo "  3. Try plugin commands:  'investigate service pet-clinic-api'"
echo ""
