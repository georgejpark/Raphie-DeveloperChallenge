import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEmail, splitSentences, countWords } from '../src/email/validate.js';
import { sanitizeEmail } from '../src/email/sanitize.js';

const CTX = { recipientName: 'Jane Doe', companyName: 'Riverline Sportsbook' };

// The two example emails from the brief must pass as-is.
const EXAMPLE_1 = `Hi Jane,

I'm reaching out from Raphie. We help support teams automate high-volume workflows like verification, withdrawals, promo eligibility, and account access, while keeping clean handoffs to human agents when a case needs review.

Given Riverline's customer-facing volume and the operational complexity that comes with US requirements, small reductions in handle time and repeat tickets can translate into a meaningful impact on cost and customer experience. Raphie focuses on fast containment for common questions, consistent policy aware replies, and escalation paths that preserve auditability for sensitive cases.

Would you be open to a quick 15-minute call next week to see if this could be useful?

Best,
Raphie`;

const EXAMPLE_2 = `Hi Jane,

Hope you're doing well. I'm reaching out from Raphie because we work with support teams in fast-moving, compliance-heavy environments where payouts, fraud reviews, and identity workflows create a steady stream of time-sensitive tickets.

From the outside, ApexPay Gaming looks like the kind of business where support demand comes from multiple sides: operators needing fast answers, and players asking about payout status, settlement timing, or wallet-related issues. Raphie helps automate repetitive workflows, guide agents with suggested replies, and keep approvals and escalation paths in place for higher-risk cases so teams can move quickly without losing control of the process.

Would you be open to a short conversation to see whether this could help reduce ticket volume and improve response times?

Warm regards,
Raphie`;

// Note: the brief's own examples contain sentences longer than 30 words
// (example 1: one of 32 words; example 2: two of 33 and 32 words). Everything
// else passes. We hold the stricter line in our own output and only assert
// here that no *other* rule fires on the examples.
test('brief example #1 passes every rule except its one 32-word sentence', () => {
  const r = validateEmail(EXAMPLE_1, CTX);
  assert.deepEqual(r.violations.map((v) => v.rule), ['sentence_length']);
  assert.match(r.violations[0].detail, /32 words/);
});

test('brief example #2 passes every rule except its two long sentences', () => {
  const r = validateEmail(EXAMPLE_2, { recipientName: 'Jane Doe', companyName: 'ApexPay Gaming' });
  assert.deepEqual(r.violations.map((v) => v.rule), ['sentence_length', 'sentence_length']);
  assert.match(r.violations[0].detail, /33 words/);
  assert.match(r.violations[1].detail, /32 words/);
});

test('em dash is a hard ban', () => {
  const r = validateEmail(EXAMPLE_1.replace('Raphie. We', 'Raphie — we'), CTX);
  assert.ok(r.violations.some((v) => v.rule === 'em_dash'));
});

test('"Furthermore"/"Additionally" at sentence start are banned, mid-sentence is fine', () => {
  const bad = validateEmail(EXAMPLE_1.replace('Raphie focuses', 'Furthermore, Raphie focuses'), CTX);
  assert.ok(bad.violations.some((v) => v.rule === 'banned_starter'));
  const bad2 = validateEmail(EXAMPLE_1.replace('Raphie focuses', 'Additionally Raphie focuses'), CTX);
  assert.ok(bad2.violations.some((v) => v.rule === 'banned_starter'));
  const ok = validateEmail(EXAMPLE_1.replace('and account access', 'and additionally account access'), CTX);
  assert.ok(!ok.violations.some((v) => v.rule === 'banned_starter'));
});

test('the word "fantastic" is banned (case-insensitive, whole word)', () => {
  const r = validateEmail(EXAMPLE_1.replace('meaningful', 'Fantastic'), CTX);
  assert.ok(r.violations.some((v) => v.rule === 'banned_word'));
});

test('at most one exclamation mark', () => {
  const one = validateEmail(EXAMPLE_1.replace('useful?', 'useful!'), CTX);
  assert.ok(!one.violations.some((v) => v.rule === 'exclamations'));
  const two = validateEmail(EXAMPLE_1.replace('useful?', 'useful!').replace('Hi Jane,', 'Hi Jane!'), CTX);
  assert.ok(two.violations.some((v) => v.rule === 'exclamations'));
});

test('two consecutive sentences may not start with the same word', () => {
  const r = validateEmail(EXAMPLE_1.replace('Raphie focuses', 'Given that, Raphie focuses').replace('Given Riverline', 'Given Riverline'), CTX);
  assert.ok(r.violations.some((v) => v.rule === 'repeated_starter'), JSON.stringify(r.violations));
  // the greeting line counts as a unit: "Hi Jane," followed by "Hi there." is a repeat
  const r2 = validateEmail(EXAMPLE_1.replace("I'm reaching out from Raphie.", 'Hi again from Raphie.'), CTX);
  assert.ok(r2.violations.some((v) => v.rule === 'repeated_starter'));
});

test('no sentence over 30 words', () => {
  const long = 'This sentence is deliberately padded with many filler words so that it goes well past the thirty word limit that the brief sets for any single sentence in the email body.';
  assert.ok(countWords(long) > 30);
  const r = validateEmail(EXAMPLE_1.replace("I'm reaching out from Raphie.", long), CTX);
  assert.ok(r.violations.some((v) => v.rule === 'sentence_length'));
});

test('sentence splitting respects line breaks and abbreviations', () => {
  const s = splitSentences('Hi Jane,\n\nWe handle e.g. withdrawals. Then more.\nBest,\nRaphie');
  assert.deepEqual(s, ['Hi Jane,', 'We handle e.g. withdrawals.', 'Then more.', 'Best,', 'Raphie']);
});

test('recipient first name and company must appear (short company form accepted)', () => {
  const r = validateEmail(EXAMPLE_1.replace(/Jane/g, 'friend'), CTX);
  assert.ok(r.violations.some((v) => v.rule === 'missing_name'));
  const r2 = validateEmail(EXAMPLE_1.replace("Riverline's", "the team's"), CTX);
  assert.ok(r2.violations.some((v) => v.rule === 'missing_company'));
  const r3 = validateEmail(EXAMPLE_1, CTX); // "Riverline's" counts for "Riverline Sportsbook"
  assert.ok(!r3.violations.some((v) => v.rule === 'missing_company'));
});

test('sanitizer repairs the mechanical rules without touching the rest', () => {
  const dirty = 'Hi Jane,\n\nWe help teams — fast! Furthermore, it is fantastic! Additionally, it works -- well.\n\nBest,\nRaphie';
  const clean = sanitizeEmail(dirty);
  assert.equal(clean.includes('—'), false);
  assert.equal((clean.match(/!/g) || []).length, 1);
  assert.equal(/\bfantastic\b/i.test(clean), false);
  assert.equal(/(^|[.!?]\s+)(Furthermore|Additionally)/m.test(clean), false);
  assert.equal(clean.includes('--'), false);
  const r = validateEmail(clean, { recipientName: 'Jane', companyName: 'teams' });
  assert.ok(!r.violations.some((v) => ['em_dash', 'banned_word', 'banned_starter', 'exclamations'].includes(v.rule)), JSON.stringify(r.violations));
});
