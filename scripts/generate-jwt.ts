#!/usr/bin/env npx tsx
/**
 * Generate a JWT token for testing the Claude Swarm API
 *
 * Usage: npx tsx scripts/generate-jwt.ts [--secret <secret>] [--user <userId>] [--expires <duration>]
 *
 * Examples:
 *   npx tsx scripts/generate-jwt.ts
 *   npx tsx scripts/generate-jwt.ts --secret mysecret --user admin --expires 7d
 */

import jwt from 'jsonwebtoken';

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

const secret = getArg('secret', process.env.JWT_SECRET || 'dev-secret-change-in-production');
const userId = getArg('user', 'admin');
const expiresIn = getArg('expires', '24h');

const payload = {
  sub: userId,
  scope: ['tasks:read', 'tasks:write', 'agents:read', 'budget:read'],
};

const token = jwt.sign(payload, secret, { expiresIn });

console.log('\n🔐 JWT Token Generated\n');
console.log('Token:');
console.log(token);
console.log('\nPayload:');
console.log(JSON.stringify(jwt.decode(token), null, 2));
console.log('\nUsage:');
console.log(
  `  curl -H "Authorization: Bearer ${token.slice(0, 20)}..." http://localhost:3000/api/tasks`
);
console.log(`\n  # Or set as environment variable:`);
console.log(`  export SWARM_TOKEN="${token}"`);
console.log('');
