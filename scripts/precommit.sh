#!/bin/bash
# Precommit validation script for claude-swarm
# Based on Marcos-One enterprise patterns

set -e

echo "🔧 Running precommit validation..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# Step 1: Lint
echo "📝 Step 1/4: Lint..."
if npm run lint 2>/dev/null; then
    echo -e "${GREEN}✅ Lint passed${NC}"
else
    echo -e "${YELLOW}⚠️ Lint has warnings/errors${NC}"
    FAILED=1
fi
echo ""

# Step 2: Type Check
echo "🔍 Step 2/4: Type check..."
if npm run type-check 2>/dev/null; then
    echo -e "${GREEN}✅ Type check passed${NC}"
else
    echo -e "${RED}❌ Type check failed${NC}"
    FAILED=1
fi
echo ""

# Step 3: Secret Detection
echo "🔐 Step 3/4: Secret detection..."
if git diff HEAD 2>/dev/null | grep -iE "(password|secret|api_key|private_key|token|moltbook_sk)" > /dev/null; then
    echo -e "${RED}❌ CRITICAL: Possible secret detected in diff!${NC}"
    FAILED=1
else
    echo -e "${GREEN}✅ No secrets detected${NC}"
fi
echo ""

# Step 4: Build
echo "🏗️ Step 4/4: Build..."
if npm run build 2>/dev/null; then
    echo -e "${GREEN}✅ Build passed${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    FAILED=1
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! Ready to commit.${NC}"
    echo ""
    echo "💡 Tip: Add 'Validated-By: claude-code' to your commit message"
    echo "   to skip redundant CI checks."
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Fix issues before committing.${NC}"
    exit 1
fi
