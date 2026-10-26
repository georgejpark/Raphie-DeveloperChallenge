/**
 * Output constraint validator.
 *
 * Raphie's directive: outbound emails must not feel AI-generated. The model is
 * *asked* to follow these rules in the prompt, but we never trust it. Every
 * draft is checked here and either repaired (see sanitize.js) or regenerated
 * with the violations fed back to the model (see generate.js).
 *
 * Hard bans (must never appear)
 *   - em dashes (—)
 *   - "Furthermore" or "Additionally" at the start of a sentence
 *   - the word "fantastic"
 * Structural constraints
 *   - no more than one exclamation mark in the whole email
 *   - no two consecutive sentences may start with the same word
 *   - no single sentence may exceed 30 words
 * Content requirements (from the brief)
 *   - recipient's first name and the company name must appear
 */

export const MAX_WORDS_PER_SENTENCE = 30;
export const MAX_EXCLAMATIONS = 1;
export const BANNED_SENTENCE_STARTERS = ['furthermore', 'additionally'];
export const BANNED_WORDS = ['fantastic'];

/**
 * Split an email into sentences, in reading order.
 * A line break always ends a sentence (so "Hi Jane," and "Best," are their own
 * units and never get glued onto the next paragraph), and ". ! ?" followed by
 * whitespace ends a sentence inside a paragraph. Common abbreviations are
 * protected so "e.g. withdrawals" does not create a bogus sentence boundary.
 */
export function splitSentences(text) {
  const protectedText = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Inc|Ltd|U\.S|St)\.\s/gi, (m) => m.replace(/\./g, '․'));
  const out = [];
  for (const line of protectedText.split(/\r?\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const s of trimmed.split(/(?<=[.!?])\s+/)) {
      const clean = s.replace(/․/g, '.').trim();
      if (clean) out.push(clean);
    }
  }
  return out;
}

/** First word of a sentence, lower-cased, punctuation stripped ("I'm" -> "i'm", "Hi," -> "hi"). */
export function firstWord(sentence) {
  const m = sentence.match(/[A-Za-z0-9''’]+/);
  return m ? m[0].toLowerCase().replace(/’/g, "'") : '';
}

export function countWords(sentence) {
  return sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/**
 * @param {string} email
 * @param {{recipientName?: string, companyName?: string}} ctx
 * @returns {{ok: boolean, violations: Array<{rule: string, detail: string}>}}
 */
export function validateEmail(email, ctx = {}) {
  const violations = [];
  const push = (rule, detail) => violations.push({ rule, detail });

  if (email.includes('—')) push('em_dash', 'Contains an em dash (—).');

  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(email)) push('banned_word', `Contains the word "${w}".`);
  }

  const bangs = (email.match(/!/g) || []).length;
  if (bangs > MAX_EXCLAMATIONS) push('exclamations', `Contains ${bangs} exclamation marks (max ${MAX_EXCLAMATIONS}).`);

  const sentences = splitSentences(email);
  let prev = null;
  for (const s of sentences) {
    const fw = firstWord(s);
    if (BANNED_SENTENCE_STARTERS.includes(fw)) push('banned_starter', `Sentence starts with "${s.split(/\s+/)[0]}": "${s}"`);
    if (prev !== null && fw && fw === prev) push('repeated_starter', `Two consecutive sentences start with "${fw}": "${s}"`);
    const n = countWords(s);
    if (n > MAX_WORDS_PER_SENTENCE) push('sentence_length', `Sentence has ${n} words (max ${MAX_WORDS_PER_SENTENCE}): "${s}"`);
    prev = fw;
  }

  if (ctx.recipientName) {
    const first = ctx.recipientName.trim().split(/\s+/)[0];
    if (first && !new RegExp(`\\b${escapeRe(first)}\\b`, 'i').test(email)) push('missing_name', `Recipient name "${first}" not found.`);
  }
  if (ctx.companyName && !email.toLowerCase().includes(ctx.companyName.trim().toLowerCase())) {
    // Allow a shortened company name (e.g. "Riverline" for "Riverline Sportsbook") as the examples do.
    const head = ctx.companyName.trim().split(/\s+/)[0];
    if (!new RegExp(`\\b${escapeRe(head)}\\b`, 'i').test(email)) push('missing_company', `Company name "${ctx.companyName}" not found.`);
  }

  return { ok: violations.length === 0, violations };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
