#!/usr/bin/env bash
# scripts/lint-plan-frontmatter.sh
# Validates that plan documents in docs/plans/ have proper YAML front matter.
# Exit 0 = all plans valid, exit 1 = issues found.
#
# Required front matter fields:
#   status: draft | active | completed | superseded
#   date: YYYY-MM-DD
#
# Optional:
#   superseded_by: filename (required when status = superseded)

set -euo pipefail
cd "$(dirname "$0")/.."

PLAN_DIR="docs/plans"
ERRORS=0
CHECKED=0
VALID_STATUSES="draft active completed superseded"

if [ ! -d "$PLAN_DIR" ]; then
  echo "No plans directory found at $PLAN_DIR"
  exit 0
fi

for plan in "$PLAN_DIR"/*.md; do
  [ -f "$plan" ] || continue
  CHECKED=$((CHECKED + 1))
  basename=$(basename "$plan")

  # Check for front matter delimiter
  first_line=$(head -1 "$plan")
  if [ "$first_line" != "---" ]; then
    echo "MISSING_FRONTMATTER: $basename — no YAML front matter (first line is not '---')"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Extract front matter (between first and second ---)
  # Check that a closing delimiter exists
  closing_line=$(sed -n '2,$ { /^---$/= }' "$plan" | head -1)
  if [ -z "$closing_line" ]; then
    echo "UNCLOSED_FRONTMATTER: $basename — no closing '---' delimiter found"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  frontmatter=$(sed -n "2,$((closing_line - 1))p" "$plan")
  if [ -z "$frontmatter" ]; then
    echo "EMPTY_FRONTMATTER: $basename — front matter block is empty"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Check required fields
  status=$(echo "$frontmatter" | grep -oP '^status:\s*\K\S+' || true)
  date_field=$(echo "$frontmatter" | grep -oP '^date:\s*\K\S+' || true)

  if [ -z "$status" ]; then
    echo "MISSING_STATUS: $basename — no 'status:' field in front matter"
    ERRORS=$((ERRORS + 1))
  elif ! echo "$VALID_STATUSES" | grep -qw "$status"; then
    echo "INVALID_STATUS: $basename — status '$status' not in ($VALID_STATUSES)"
    ERRORS=$((ERRORS + 1))
  fi

  if [ -z "$date_field" ]; then
    echo "MISSING_DATE: $basename — no 'date:' field in front matter"
    ERRORS=$((ERRORS + 1))
  elif ! echo "$date_field" | grep -qP '^\d{4}-\d{2}-\d{2}$'; then
    echo "INVALID_DATE: $basename — date '$date_field' not in YYYY-MM-DD format"
    ERRORS=$((ERRORS + 1))
  fi

  # If superseded, must have superseded_by
  if [ "$status" = "superseded" ]; then
    superseded_by=$(echo "$frontmatter" | grep -oP '^superseded_by:\s*\K.+' || true)
    if [ -z "$superseded_by" ]; then
      echo "MISSING_SUPERSEDED_BY: $basename — status is 'superseded' but no 'superseded_by:' field"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

echo ""
echo "Checked $CHECKED plan(s)."
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS issue(s) found."
  exit 1
else
  echo "PASSED: All plans have valid front matter."
  exit 0
fi
