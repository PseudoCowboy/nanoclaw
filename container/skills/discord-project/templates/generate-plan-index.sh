#!/bin/bash
# Generate plan index from all plan files in a project
# Usage: bash generate-plan-index.sh [project-root]
# Output: PROJECT_ROOT/PLAN-INDEX.md

PROJECT_ROOT="${1:-.}"
OUTPUT="$PROJECT_ROOT/PLAN-INDEX.md"

echo "# Plan Index" > "$OUTPUT"
echo "" >> "$OUTPUT"
echo "Auto-generated: $(date -Iseconds)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| Status | Plan | Author | Created |" >> "$OUTPUT"
echo "|--------|------|--------|---------|" >> "$OUTPUT"

find "$PROJECT_ROOT/plans" "$PROJECT_ROOT/docs" -name "plan-v2.md" -o -name "*.plan.md" 2>/dev/null | sort | while read -r file; do
  status=$(grep -m1 "^\*\*Status:\*\*" "$file" 2>/dev/null | sed 's/\*\*Status:\*\* *//')
  author=$(grep -m1 "^\*\*Author:\*\*" "$file" 2>/dev/null | sed 's/\*\*Author:\*\* *//')
  created=$(grep -m1 "^\*\*Created:\*\*" "$file" 2>/dev/null | sed 's/\*\*Created:\*\* *//')
  title=$(head -1 "$file" | sed 's/^# *//')
  relpath="${file#$PROJECT_ROOT/}"

  [ -z "$status" ] && status="unknown"
  [ -z "$created" ] && created="-"
  [ -z "$author" ] && author="-"

  echo "| $status | [$title]($relpath) | $author | $created |" >> "$OUTPUT"
done

echo "" >> "$OUTPUT"
echo "---" >> "$OUTPUT"
echo "Run \`bash generate-plan-index.sh\` to refresh." >> "$OUTPUT"
