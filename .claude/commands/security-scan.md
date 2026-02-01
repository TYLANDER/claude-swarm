Run security analysis on the codebase.

Steps:
1. Run `npm audit` to check for vulnerable dependencies
2. Run `npm audit --audit-level=high` for critical issues only
3. Check for outdated dependencies: `npm outdated`
4. Scan for secrets/credentials accidentally committed:
   - Look for `.env` files in git: `git ls-files | grep -E '\.env'`
   - Search for API keys: `grep -r "api[_-]?key" --include="*.ts" --include="*.js" | grep -v node_modules | head -20`
5. Check for `console.log` statements in production code

Report findings with severity levels:
- 🔴 CRITICAL: Must fix immediately
- 🟠 HIGH: Fix before next release
- 🟡 MEDIUM: Schedule for remediation
- 🟢 LOW: Informational
