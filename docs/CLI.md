# Claude Swarm CLI

Command-line interface for submitting tasks and monitoring the agent swarm.

## Installation

```bash
# From the repository
npm install
npm run build
npm link packages/cli

# Or globally (when published)
npm install -g @claude-swarm/cli
```

## Configuration

Set the orchestrator URL:

```bash
swarm config --set orchestratorUrl=https://your-orchestrator.azurecontainerapps.io
```

View current config:

```bash
swarm config --list
```

## Commands

### Submit Tasks

Submit a single task:

```bash
swarm submit -p "Fix the bug in auth.ts where users can't log out"
```

Submit with options:

```bash
swarm submit \
  -p "Add unit tests for the UserService class" \
  --type test \
  --model sonnet \
  --branch feature/user-tests \
  --files "src/services/UserService.ts" \
  --budget 200 \
  --timeout 45
```

Submit from a file:

```bash
swarm submit -f tasks.json
```

Task file format:

```json
[
  {
    "type": "code",
    "prompt": "Implement the payment webhook handler",
    "context": {
      "branch": "feature/payments",
      "files": ["src/webhooks/stripe.ts"]
    },
    "budgetCents": 150
  },
  {
    "type": "test",
    "prompt": "Add integration tests for the webhook",
    "context": {
      "branch": "feature/payments",
      "files": ["src/webhooks/stripe.ts"],
      "dependencies": ["task-1"]
    }
  }
]
```

### Check Status

Check a specific task:

```bash
swarm status <task-id>
```

Watch for updates:

```bash
swarm status <task-id> --watch
```

### Monitor Agents

List active agents:

```bash
swarm agents
```

Show all agents including completed:

```bash
swarm agents --all
```

### Budget Status

View budget and usage:

```bash
swarm budget
```

### Real-time Updates

Watch all events in real-time:

```bash
swarm watch
```

## Task Types

| Type       | Description          | Typical Use                   |
| ---------- | -------------------- | ----------------------------- |
| `code`     | Implementation tasks | New features, bug fixes       |
| `test`     | Testing tasks        | Unit tests, integration tests |
| `review`   | Code review          | PR reviews, security audits   |
| `doc`      | Documentation        | README updates, API docs      |
| `security` | Security analysis    | Vulnerability scanning        |

## Models

| Model    | Cost            | Best For             |
| -------- | --------------- | -------------------- |
| `sonnet` | $3/$15 per MTok | Most tasks (default) |
| `opus`   | $5/$25 per MTok | Complex reasoning    |

## Priority Levels

| Priority | Queue           | Use Case        |
| -------- | --------------- | --------------- |
| `high`   | Processed first | Blocking issues |
| `normal` | Standard queue  | Regular tasks   |
| `low`    | Background      | Cleanup, docs   |

## Examples

### Feature Implementation

```bash
swarm submit \
  -p "Implement user avatar upload with S3 storage. Include validation for file size (max 5MB) and type (png, jpg, gif)." \
  --type code \
  --branch feature/avatars \
  --files "src/services/UserService.ts,src/routes/users.ts" \
  --budget 300
```

### Bug Fix

```bash
swarm submit \
  -p "Fix issue #123: Users seeing stale data after profile update. The cache invalidation in ProfileService isn't working correctly." \
  --type code \
  --priority high \
  --files "src/services/ProfileService.ts,src/cache/index.ts"
```

### Test Suite

```bash
swarm submit \
  -p "Add comprehensive unit tests for OrderService. Cover all public methods with edge cases." \
  --type test \
  --files "src/services/OrderService.ts" \
  --budget 200
```

### Code Review

```bash
swarm submit \
  -p "Review the authentication changes in this branch for security issues. Focus on session handling and token validation." \
  --type review \
  --branch feature/auth-refactor
```

### Batch Tasks

```bash
cat << 'EOF' > tasks.json
[
  {"type": "code", "prompt": "Add input validation to UserController", "context": {"files": ["src/controllers/UserController.ts"]}},
  {"type": "code", "prompt": "Add input validation to OrderController", "context": {"files": ["src/controllers/OrderController.ts"]}},
  {"type": "code", "prompt": "Add input validation to ProductController", "context": {"files": ["src/controllers/ProductController.ts"]}}
]
EOF

swarm submit -f tasks.json
```

## Output Format

### Task Submission

```
✔ Submitted 3 task(s)

Task IDs:
  a1b2c3d4-e5f6-7890-abcd-ef1234567890
  b2c3d4e5-f6g7-8901-bcde-fg2345678901
  c3d4e5f6-g7h8-9012-cdef-gh3456789012

Estimated cost: $3.60

Watch progress: swarm watch
Check status:   swarm status a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Budget Status

```
Budget Status
────────────────────────────────────────────────────────

  Daily Usage
  ██████████░░░░░░░░░░░░░░░░░░░░ 33.5%
  $33.50 / $100.00

  Weekly Usage
  ████░░░░░░░░░░░░░░░░░░░░░░░░░░ 13.4%
  $67.00 / $500.00

────────────────────────────────────────────────────────
  Projected daily: $45.00
  Per-task limit:  $5.00
  Last updated:    1/28/2026, 2:30:45 PM
```
