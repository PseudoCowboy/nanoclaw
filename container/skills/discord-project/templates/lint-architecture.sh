#!/bin/bash
# Architecture linter — checks dependency direction rules
# Run from project root: bash lint-architecture.sh
# Exit 0 = clean, Exit 1 = violations found

PROJECT_ROOT="${1:-.}"
SRC="$PROJECT_ROOT/src"
VIOLATIONS=0

if [ ! -d "$SRC" ]; then
  echo "No src/ directory found. Skipping architecture lint."
  exit 0
fi

check_violation() {
  local from_layer="$1"
  local forbidden_import="$2"
  local rule="$3"

  if [ -d "$SRC/$from_layer" ]; then
    matches=$(grep -rn "from.*['\"].*/$forbidden_import/" "$SRC/$from_layer" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      echo ""
      echo "❌ VIOLATION: $rule"
      echo "   REMEDIATION: Move the shared logic to a lower layer, or invert the dependency."
      echo "   Files:"
      echo "$matches" | sed 's/^/   /'
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
}

echo "=== Architecture Lint ==="
echo "Checking dependency direction rules in $SRC"
echo ""

# models/ must not import from services/ or api/
check_violation "models" "services" "models/ imports from services/ (models must be leaf-level)"
check_violation "models" "api" "models/ imports from api/ (models must be leaf-level)"

# services/ must not import from api/
check_violation "services" "api" "services/ imports from api/ (services must not depend on handlers)"

# api/ must not import from api/ (no handler-to-handler)
check_violation "api" "api" "api/ imports from api/ (no handler-to-handler calls)"

# utils/ must not import from services/, api/, or models/
check_violation "utils" "services" "utils/ imports from services/ (utils must be leaf-level)"
check_violation "utils" "api" "utils/ imports from api/ (utils must be leaf-level)"
check_violation "utils" "models" "utils/ imports from models/ (utils must be leaf-level)"

if [ $VIOLATIONS -eq 0 ]; then
  echo "✅ All dependency direction rules pass."
  exit 0
else
  echo ""
  echo "Found $VIOLATIONS violation(s). Fix them before committing."
  exit 1
fi
