#!/bin/bash
# Structural tests — verify project scaffolding invariants
# Run from project root: bash test-structure.sh

PROJECT_ROOT="${1:-.}"
FAILURES=0

assert_dir() {
  if [ ! -d "$PROJECT_ROOT/$1" ]; then
    echo "❌ FAIL: Directory '$1' missing"
    echo "   REMEDIATION: Run 'mkdir -p $PROJECT_ROOT/$1'"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_file() {
  if [ ! -f "$PROJECT_ROOT/$1" ]; then
    echo "❌ FAIL: File '$1' missing"
    echo "   REMEDIATION: $2"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== Structural Tests ==="

# Required directories
assert_dir "src"
assert_dir "tests"
assert_dir "docs"
assert_dir "plans"

# Required files
assert_file "ARCHITECTURE.md" "Create from template: copy from plans/templates/"
assert_file "README.md" "Create a project README with overview and structure"
assert_file "GOLDEN-PRINCIPLES.md" "Create with project coding standards and invariants"

# Test mirrors src structure
if [ -d "$PROJECT_ROOT/src" ]; then
  for dir in "$PROJECT_ROOT/src"/*/; do
    dirname=$(basename "$dir")
    if [ ! -d "$PROJECT_ROOT/tests/$dirname" ]; then
      echo "⚠️  WARN: tests/$dirname/ missing (should mirror src/$dirname/)"
      echo "   REMEDIATION: Run 'mkdir -p $PROJECT_ROOT/tests/$dirname'"
    fi
  done
fi

if [ $FAILURES -eq 0 ]; then
  echo "✅ All structural tests pass."
  exit 0
else
  echo ""
  echo "Found $FAILURES failure(s)."
  exit 1
fi
