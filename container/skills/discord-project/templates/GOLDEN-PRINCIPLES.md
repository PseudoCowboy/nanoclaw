# Golden Principles

These are the coding standards enforced across this project. The architecture linter and structural tests check these mechanically. Agents must follow these in all code they write.

## 1. Dependency Direction

Dependencies flow one way: `api -> services -> models`. No reverse imports.

- `api/` depends on `services/` only
- `services/` depends on `models/` and `utils/`
- `models/` depends on nothing (leaf-level)
- `utils/` depends on nothing (leaf-level)
- No handler-to-handler imports (`api/` -> `api/`)

## 2. Validate at Boundaries

All external input is validated at the API boundary. Internal code trusts validated types.

- Parse, don't validate: convert raw input to typed structures at the edge
- Never pass raw strings/objects through service layers
- Errors from validation are structured, not raw throws

## 3. Tests Mirror Source

Every `src/<module>/` has a corresponding `tests/<module>/` directory.

- New source files get test files
- Test files live next to what they test (by module)
- No test code in `src/`

## 4. Structured Errors

All errors are typed/structured. No `throw new Error("something")` with bare strings.

- Use error classes or error objects with codes
- Errors carry enough context to diagnose without reading logs
- API layer translates internal errors to HTTP responses

## 5. Shared Utilities Over Duplication

If two modules need the same logic, it goes in `utils/`.

- Don't copy-paste between `api/` and `services/`
- `utils/` is the canonical location for shared helpers
- Keep `utils/` dependency-free (no imports from other layers)

## 6. Commit Discipline

- Every commit message describes the "why", not just the "what"
- Pre-commit hooks must pass (lint + structural tests)
- Never skip hooks (`--no-verify`)
- One logical change per commit

## 7. Plan Before Build

Features start with a plan in `plans/`. No implementation without a written plan.

- Use `plans/plan-template.md` as the starting point
- Record decisions in the Decision Log
- Update plan status as work progresses
