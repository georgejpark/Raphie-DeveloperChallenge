/**
 * Generation loop: draft -> validate -> (feed violations back and redraft) ->
 * sanitize the mechanical leftovers -> final validation.
 *
 * Why a loop and not a single call: the structural rules (30-word sentences,
 * no repeated sentence starters) are the ones LLMs break most often, and they
 * cannot be fixed by string replacement without hurting the prose. Feeding
 * the exact violations back produces a clean rewrite almost every time, and
 * the deterministic sanitizer catches anything mechanical that remains.
 */
import OpenAI from 'openai';
import { systemPrompt, userPrompt } from './prompt.js';
import { validateEmail } from './validate.js';
import { sanitizeEmail } from './sanitize.js';

export const DEFAULT_MODEL = 'gpt-4o-mini';

export function createOpenAIClient(env = process.env) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Copy .env.example to .env or export it in your shell.');
  }
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined, maxRetries: 2, timeout: 60_000 });
}

/**
 * @param {object} args
 * @param {{recipientName: string, companyName: string, description: string, tone: 'direct'|'warm'}} args.input
 * @param {object} args.conditioning   from buildConditioning()
 * @param {OpenAI} args.client
 * @param {string} [args.model]
 * @param {number} [args.maxAttempts]  model calls allowed (default 3)
 * @param {(msg: string) => void} [args.log]
 * @returns {Promise<{email: string, attempts: number, sanitized: boolean, validation: {ok: boolean, violations: any[]}, history: Array<{attempt: number, violations: any[]}>}>}
 */
export async function generateEmail({ input, conditioning, client, model = process.env.OPENAI_MODEL || DEFAULT_MODEL, maxAttempts = 3, log = () => {} }) {
  const ctx = { recipientName: input.recipientName, companyName: input.companyName };
  const history = [];
  let draft = '';
  let feedback = {};

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await client.chat.completions.create({
      model,
      // first draft gets a little creativity; rewrites are asked to be precise
      temperature: attempt === 1 ? 0.7 : 0.3,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(input, conditioning, feedback) },
      ],
    });
    draft = cleanModelOutput(completion.choices?.[0]?.message?.content || '');
    const result = validateEmail(draft, ctx);
    history.push({ attempt, violations: result.violations });
    log(`attempt ${attempt}: ${result.ok ? 'clean' : result.violations.length + ' violation(s)'}`);
    if (result.ok) return { email: draft, attempts: attempt, sanitized: false, validation: result, history };
    feedback = { violations: result.violations, previous: draft };
  }

  // Last resort: fix what can be fixed mechanically, then report honestly.
  const repaired = sanitizeEmail(draft);
  const validation = validateEmail(repaired, ctx);
  log(`sanitized after ${maxAttempts} attempts: ${validation.ok ? 'clean' : validation.violations.length + ' violation(s) remain'}`);
  return { email: repaired, attempts: maxAttempts, sanitized: true, validation, history };
}

/** Strip code fences / "Subject:" lines a model sometimes adds despite instructions. */
export function cleanModelOutput(text) {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  t = t.replace(/^subject:.*\n+/i, '');
  // normalise exotic whitespace / quotes the validator does not care about but mail clients render oddly
  t = t.replace(/ /g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  return t.trim();
}
