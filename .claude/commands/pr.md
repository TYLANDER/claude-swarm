Prepare a pull request for the current changes.

Steps:
1. Run `git status` to see what's changed
2. Run `git diff --staged` (if files are staged) or `git diff` to review changes
3. Run the validation suite: `npm run lint && npm run type-check && npm run test`
4. If validation passes, stage all changes: `git add -A`
5. Create a commit with conventional commit format:
   - feat: for new features
   - fix: for bug fixes  
   - refactor: for code refactoring
   - docs: for documentation
   - test: for tests
   - chore: for maintenance
6. Add "Validated-By: arnoldbot" to the commit message footer
7. Push to origin
8. Use `gh pr create` to create a pull request with:
   - Clear title matching the commit
   - Description summarizing changes
   - Test plan section

If validation fails, fix the issues first before creating the PR.
