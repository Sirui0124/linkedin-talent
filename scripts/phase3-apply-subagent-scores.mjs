#!/usr/bin/env node

import { execFileSync } from 'child_process';

const args = process.argv.slice(2);

if (!args.length) {
  console.error('Usage: node scripts/phase3-apply-subagent-scores.mjs --batch-id <id> --scores <scores.json>');
  process.exit(1);
}

execFileSync('node', ['scripts/phase3-profile-score.mjs', '--llm-only', ...args], {
  stdio: 'inherit',
});
