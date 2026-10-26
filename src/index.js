#!/usr/bin/env node
/**
 * raphie — generate a constraint-checked cold outreach email.
 *
 * Flow (see README "How it works"):
 *   1. collect input (readline, or flags)        src/cli/prompts.js
 *   2. call the go-to-market helper, with retries src/gtm/client.js
 *   3. interpret helper + description -> angles  src/gtm/interpret.js
 *   4. build the prompt and call OpenAI           src/email/prompt.js, generate.js
 *   5. validate, redraft if needed, sanitize      src/email/validate.js, sanitize.js
 *   6. print the email (and a short report with --debug)
 */
import { parseArgs } from 'node:util';
import { loadDotEnv } from './util/env.js';
import { collectInput, validateInput, TONES } from './cli/prompts.js';
import { fetchCompanyAnalysis } from './gtm/client.js';
import { buildConditioning } from './gtm/interpret.js';
import { createOpenAIClient, generateEmail } from './email/generate.js';

const HELP = `Usage: raphie [options]

Generates a cold outreach email from Raphie. Prompts for anything not given as a flag.

Options
  --name <recipient>          Recipient's name, e.g. "Alex Gould"
  --company <company>         Company name, e.g. "Big Bet Sports"
  --description <text>        Short description of the company
  --tone <direct|warm>        Tone of the email
  --skip-helper               Skip the go-to-market helper endpoint
  --max-attempts <n>          Model calls allowed before mechanical repair (default 3)
  --debug                     Print the helper response, confidence tier, and validation report
  --json                      Print a JSON object instead of plain text (for scripting)
  -h, --help                  Show this help

Environment
  OPENAI_API_KEY (required), OPENAI_MODEL, OPENAI_BASE_URL,
  GTM_ENDPOINT, GTM_TIMEOUT_MS, GTM_RETRIES   (see .env.example)
`;

export async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        name: { type: 'string' },
        company: { type: 'string' },
        description: { type: 'string' },
        tone: { type: 'string' },
        'skip-helper': { type: 'boolean', default: false },
        'max-attempts': { type: 'string', default: '3' },
        debug: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) { process.stdout.write(HELP); return 0; }

  const pre = { recipientName: args.name, companyName: args.company, description: args.description, tone: args.tone };
  const flagErrors = validateInput(pre);
  if (flagErrors.length) {
    process.stderr.write(flagErrors.join('\n') + `\n(tone must be one of: ${TONES.join(', ')})\n`);
    return 2;
  }

  const log = args.debug ? (m) => process.stderr.write(`[debug] ${m}\n`) : () => {};
  const info = args.json ? () => {} : (m) => process.stderr.write(`${m}\n`);

  // 0. fail fast on the API key before asking the user to type four answers
  let client;
  try { client = createOpenAIClient(); } catch (err) { process.stderr.write(`Error: ${err.message}\n`); return 1; }

  // 1. input
  let input;
  try { input = await collectInput(pre); } catch (err) { process.stderr.write(`\n${err.message}\n`); return 2; }

  // 2. go-to-market helper (never fatal)
  let helper = { status: 'skipped', reason: '--skip-helper' };
  if (!args['skip-helper']) {
    info('Looking up go-to-market hints...');
    helper = await fetchCompanyAnalysis(input.companyName, { log });
    if (helper.status === 'ok') log(`helper response: ${JSON.stringify(helper.data)}`);
    else info(`Go-to-market helper unavailable (${helper.reason}); writing from the description alone.`);
  }

  // 3. conditioning
  const conditioning = buildConditioning(input, helper);
  log(`confidence tier: ${conditioning.tier}; company type: ${conditioning.companyType || 'unknown'} (${conditioning.typeSource || 'n/a'}); angles: ${conditioning.angles.map((a) => a.key + (a.assert ? '' : '?')).join(', ') || 'none'}`);
  for (const n of conditioning.notes) log(`note: ${n}`);
  if (conditioning.tier === 'low') info('Helper confidence is low; its hints were not used.');
  else if (conditioning.tier === 'medium') info('Helper confidence is medium; its hints are used with hedged wording.');

  // 4-5. generate + validate
  info('Drafting the email...');
  const maxAttempts = Math.max(1, Number(args['max-attempts']) || 3);
  let result;
  try {
    result = await generateEmail({ input, conditioning, client, maxAttempts, log });
  } catch (err) {
    process.stderr.write(`OpenAI request failed: ${err?.message || err}\n`);
    return 1;
  }

  // 6. output
  if (args.json) {
    process.stdout.write(JSON.stringify({
      input,
      helper: helper.status === 'ok' ? helper.data : { status: helper.status, reason: helper.reason },
      confidenceTier: conditioning.tier,
      companyType: conditioning.companyType,
      angles: conditioning.angles,
      attempts: result.attempts,
      sanitized: result.sanitized,
      validation: result.validation,
      email: result.email,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`\n${result.email}\n\n`);
    const v = result.validation;
    if (v.ok) info(`Checks passed (${result.attempts} draft${result.attempts > 1 ? 's' : ''}${result.sanitized ? ', mechanical repair applied' : ''}).`);
    else info(`WARNING: ${v.violations.length} rule(s) still broken after ${result.attempts} drafts:\n  - ` + v.violations.map((x) => x.detail).join('\n  - '));
  }
  return result.validation.ok ? 0 : 3;
}

// run only when executed directly (not when imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (err) => { process.stderr.write(`Unexpected error: ${err?.stack || err}\n`); process.exit(1); });
}
