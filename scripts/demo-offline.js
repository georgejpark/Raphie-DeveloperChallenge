#!/usr/bin/env node
/**
 * One-command offline demo: starts the mock server, runs the CLI three times
 * (HIGH / MEDIUM-with-503 / LOW confidence), prints the results, stops the mock.
 * No network or API key needed:  npm run demo:offline
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = spawn(process.execPath, ['scripts/mock-server.js'], { cwd: root, env: { ...process.env, MOCK_PORT: '8787', MOCK_DIRTY_FIRST: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
await sleep(600);
const env = { ...process.env, OPENAI_API_KEY: 'mock', OPENAI_BASE_URL: 'http://127.0.0.1:8787/v1', GTM_ENDPOINT: 'http://127.0.0.1:8787/company-analysis' };
const runs = [
  ['HIGH confidence operator, direct tone, first draft deliberately dirty -> redraft', ['--name', 'Jane Doe', '--company', 'Big Bet Sports', '--description', 'A sportsbook operator with high withdrawal volume, KYC questions, promo eligibility disputes, and periodic support spikes on big game days', '--tone', 'direct']],
  ['MEDIUM confidence payments company, warm tone, helper returns 503 once -> retry', ['--name', 'Jane Doe', '--company', 'ApexPay Gaming flaky', '--description', 'A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps, and handles a high volume of payout status and fraud review tickets', '--tone', 'warm']],
  ['LOW confidence -> helper discarded, description only', ['--name', 'Alex Gould', '--company', 'Mystery Co', '--description', 'A small affiliate network running comparison sites with commission disputes', '--tone', 'warm']],
];
let failed = false;
for (const [title, args] of runs) {
  process.stdout.write(`\n==================== ${title} ====================\n`);
  const r = spawnSync(process.execPath, ['src/index.js', ...args, '--debug'], { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}
mock.kill();
process.exit(failed ? 1 : 0);
