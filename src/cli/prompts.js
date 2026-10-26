/**
 * Interactive prompts (readline) with validation. Anything already supplied
 * as a flag is not asked again, so the same binary works interactively and
 * in scripts/CI.
 */
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

export const TONES = ['direct', 'warm'];

const QUESTIONS = [
  { key: 'recipientName', label: "Recipient's name", example: 'Alex Gould', validate: nonEmpty },
  { key: 'companyName', label: 'Company name', example: 'Big Bet Sports', validate: nonEmpty },
  { key: 'description', label: 'Short description of the company', example: 'A sportsbook operator with high withdrawal volume and frequent KYC tickets', validate: minWords(3) },
  { key: 'tone', label: 'Tone (direct / warm)', example: 'direct', validate: tone, normalize: (v) => v.trim().toLowerCase() },
];

function nonEmpty(v) { return v.trim() ? null : 'Please enter a value.'; }
function minWords(n) { return (v) => (v.trim().split(/\s+/).filter(Boolean).length >= n ? null : `Please give at least ${n} words so the email has something to work with.`); }
function tone(v) { return TONES.includes(v.trim().toLowerCase()) ? null : `Please type one of: ${TONES.join(', ')}.`; }

/** Validate pre-supplied flag values with the same rules as the interactive prompts. */
export function validateInput(partial) {
  const errors = [];
  for (const q of QUESTIONS) {
    const v = partial[q.key];
    if (v === undefined || v === null || v === '') continue;
    const err = q.validate(String(v));
    if (err) errors.push(`--${flagName(q.key)}: ${err}`);
  }
  return errors;
}

export async function collectInput(partial = {}) {
  const answers = {};
  for (const q of QUESTIONS) {
    const pre = partial[q.key];
    if (pre !== undefined && pre !== null && pre !== '') {
      answers[q.key] = q.normalize ? q.normalize(String(pre)) : String(pre).trim();
    }
  }
  const missing = QUESTIONS.filter((q) => !(q.key in answers));
  if (missing.length === 0) return answers;

  const ask = lineReader();
  try {
    for (const q of missing) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const raw = await ask(`${q.label} (e.g. "${q.example}"): `);
        const err = q.validate(raw);
        if (!err) { answers[q.key] = q.normalize ? q.normalize(raw) : raw.trim(); break; }
        output.write(`  ${err}\n`);
      }
    }
  } finally {
    ask.close();
  }
  return answers;
}

/**
 * A prompt function that works both on a TTY and with piped stdin.
 * readline emits every piped line at once; a plain rl.question() would keep
 * only the first and silently drop the rest, so we queue lines ourselves.
 */
function lineReader() {
  const rl = readline.createInterface({ input, output, terminal: input.isTTY === true });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (line) => { const w = waiters.shift(); if (w) w.resolve(line); else queue.push(line); });
  rl.on('close', () => { closed = true; for (const w of waiters.splice(0)) w.reject(new Error('Input closed before all questions were answered.')); });
  const ask = (promptText) => new Promise((resolve, reject) => {
    output.write(promptText);
    if (queue.length) { const line = queue.shift(); if (!input.isTTY) output.write(line + '\n'); return resolve(line); }
    if (closed) return reject(new Error('Input closed before all questions were answered.'));
    waiters.push({ resolve: (l) => { if (!input.isTTY) output.write(l + '\n'); resolve(l); }, reject });
  });
  ask.close = () => rl.close();
  return ask;
}

function flagName(key) {
  return { recipientName: 'name', companyName: 'company', description: 'description', tone: 'tone' }[key];
}
