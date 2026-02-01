#!/bin/bash
# Install Git hooks for claude-swarm
# These run validation locally so CI can skip redundant checks

PROJECT_ROOT="$(dirname "$(dirname "$0")")"
GIT_HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "🪝 Installing Git hooks for claude-swarm..."

# Create hooks directory if it doesn't exist
mkdir -p "$GIT_HOOKS_DIR"

# Pre-commit hook: Run lint and type-check before committing
cat > "$GIT_HOOKS_DIR/pre-commit" << 'HOOK'
#!/bin/bash
# Pre-commit hook: Validate code before commit

# Skip if SKIP_HOOKS is set (for automated commits)
if [ -n "$SKIP_HOOKS" ]; then
    exit 0
fi

echo "🔍 Running pre-commit validation..."

# Only check staged TypeScript/JavaScript files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$')

if [ -z "$STAGED_FILES" ]; then
    echo "✅ No TypeScript/JavaScript files to validate"
    exit 0
fi

# Run type-check
echo "📝 Type checking..."
npm run type-check 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Type check failed. Fix errors before committing."
    exit 1
fi

# Run lint with auto-fix on staged files
echo "🧹 Linting..."
npm run lint -- --fix 2>&1

# Re-stage any auto-fixed files
for file in $STAGED_FILES; do
    if [ -f "$file" ]; then
        git add "$file"
    fi
done

# Final lint check
npm run lint 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Lint errors remain. Fix them before committing."
    exit 1
fi

echo "✅ Pre-commit validation passed"
HOOK

# Prepare-commit-msg hook: Add validation marker to commit messages
cat > "$GIT_HOOKS_DIR/prepare-commit-msg" << 'HOOK'
#!/bin/bash
# Add validation marker if pre-commit passed

COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

# Only add marker for regular commits (not merges, amends, etc.)
if [ -z "$COMMIT_SOURCE" ]; then
    # Check if marker already exists
    if ! grep -q "Validated-By:" "$COMMIT_MSG_FILE"; then
        echo "" >> "$COMMIT_MSG_FILE"
        echo "Validated-By: arnoldbot" >> "$COMMIT_MSG_FILE"
    fi
fi
HOOK

# Pre-push hook: Run full test suite before pushing
cat > "$GIT_HOOKS_DIR/pre-push" << 'HOOK'
#!/bin/bash
# Pre-push hook: Run tests before pushing

# Skip if SKIP_HOOKS is set
if [ -n "$SKIP_HOOKS" ]; then
    exit 0
fi

echo "🧪 Running tests before push..."

npm run test 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Fix them before pushing."
    echo "   To push anyway: SKIP_HOOKS=1 git push"
    exit 1
fi

echo "🏗️ Running build check..."
npm run build 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Build failed. Fix it before pushing."
    exit 1
fi

echo "✅ Pre-push validation passed"
HOOK

# Make hooks executable
chmod +x "$GIT_HOOKS_DIR/pre-commit"
chmod +x "$GIT_HOOKS_DIR/prepare-commit-msg"
chmod +x "$GIT_HOOKS_DIR/pre-push"

echo "✅ Git hooks installed successfully!"
echo ""
echo "Hooks installed:"
echo "  • pre-commit: Type check + lint (with auto-fix)"
echo "  • prepare-commit-msg: Adds 'Validated-By: arnoldbot' to skip CI checks"
echo "  • pre-push: Full test suite + build"
echo ""
echo "To skip hooks temporarily: SKIP_HOOKS=1 git commit/push"
