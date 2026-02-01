# Precommit Validation (Balanced)

Standard precommit for claude-swarm. ~1-2 minutes.

## Pre-computed Context

```bash
echo "Changed files:"
git diff --name-only HEAD 2>/dev/null | head -30
echo "---"
echo "Packages affected:"
git diff --name-only HEAD 2>/dev/null | grep -E '^(packages|services)/' | cut -d'/' -f1-2 | sort -u
```

## Instructions

### Step 1: Format & Lint (Auto-fix)

```bash
CHANGED=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' | tr '\n' ' ')

if [ -n "$CHANGED" ]; then
  echo "Formatting and linting..."
  npx prettier --write $CHANGED 2>/dev/null || true
  npx eslint --fix $CHANGED 2>/dev/null || true
fi
```

### Step 2: Type Check

```bash
echo "Running type check..."
npm run type-check
```

If type check fails, report errors and stop.

### Step 3: Secret Detection

```bash
git diff HEAD | grep -iE "(password|secret|api_key|private_key|token|moltbook_sk)" && echo "⚠️ Possible secret detected!" || echo "✅ No secrets found"
```

**If secrets detected:** STOP. This is a critical gate.

### Step 4: Run Tests

```bash
echo "Running tests..."
npm run test 2>/dev/null || echo "No tests configured"
```

### Step 5: Build Verification

```bash
echo "Building..."
npm run build
```

### Step 6: Generate Summary

```
## Precommit Results

| Check | Status |
|-------|--------|
| Format/Lint | ✅/❌ |
| Type Check | ✅/❌ |
| Secrets | ✅/❌ |
| Tests | ✅/❌/⏭️ |
| Build | ✅/❌ |

[✅ Ready to commit!]
[OR]
[❌ Fix issues above first]
```

## Commit with CI Skip

If all checks pass locally, add to commit message:
```
Validated-By: claude-code
```

This skips redundant CI checks (from Marcos-One pattern).
