Run full validation suite before committing.

Execute in order:
1. `npm run lint` - Check for linting errors
2. `npm run type-check` - TypeScript type checking
3. `npm run test` - Run test suite
4. `npm run build` - Verify build succeeds

Report results for each step. If all pass, create the precommit marker:
`touch /tmp/claude-precommit-pass`

This marker allows git commits to proceed (see PreToolUse hook).
