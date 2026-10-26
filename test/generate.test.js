import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmail, cleanModelOutput } from '../src/email/generate.js';
import { buildConditioning } from '../src/gtm/interpret.js';

const INPUT = { recipientName: 'Jane Doe', companyName: 'Riverline Sportsbook', description: 'A sportsbook operator with high withdrawal volume and KYC questions', tone: 'direct' };
const COND = buildConditioning(INPUT, { status: 'unavailable', reason: 'test' });

const CLEAN = `Hi Jane,

I'm reaching out from Raphie. We help sportsbook support teams automate withdrawals, verification, and account access questions, with clean handoffs to agents when a case needs review.

Riverline's withdrawal volume and KYC load mean the same questions arrive every day. Raphie contains those quickly and gives agents consistent, policy-aware replies for the rest.

Would you be open to a 15-minute call next week?

Best,
Raphie`;

const DIRTY = CLEAN.replace('I\'m reaching out from Raphie.', 'I\'m reaching out from Raphie — we are fantastic!').replace('Would you', 'Would you please, please');

/** Fake OpenAI client: returns scripted drafts and records the prompts it received. */
function fakeClient(drafts) {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content: drafts[Math.min(calls.length - 1, drafts.length - 1)] } }] }; } } },
  };
}

test('clean first draft is returned after one call', async () => {
  const client = fakeClient([CLEAN]);
  const r = await generateEmail({ input: INPUT, conditioning: COND, client, model: 'test' });
  assert.equal(r.attempts, 1);
  assert.equal(r.sanitized, false);
  assert.equal(r.validation.ok, true);
  assert.equal(client.calls[0].model, 'test');
  assert.match(client.calls[0].messages[1].content, /Riverline Sportsbook/);
});

test('violations are fed back and the redraft is accepted', async () => {
  const client = fakeClient([DIRTY, CLEAN]);
  const r = await generateEmail({ input: INPUT, conditioning: COND, client, model: 'test' });
  assert.equal(r.attempts, 2);
  assert.equal(r.validation.ok, true);
  const second = client.calls[1].messages[1].content;
  assert.match(second, /previous draft broke these rules/);
  assert.match(second, /em dash/);
  assert.match(second, /fantastic/);
  assert.ok(client.calls[1].temperature < client.calls[0].temperature);
});

test('after the attempt budget the draft is sanitized and reported honestly', async () => {
  const client = fakeClient([DIRTY, DIRTY, DIRTY]);
  const r = await generateEmail({ input: INPUT, conditioning: COND, client, model: 'test', maxAttempts: 3 });
  assert.equal(r.attempts, 3);
  assert.equal(r.sanitized, true);
  assert.equal(r.email.includes('—'), false);
  assert.equal(/fantastic/i.test(r.email), false);
  assert.equal(r.validation.ok, true, JSON.stringify(r.validation.violations));
  assert.equal(r.history.length, 3);
});

test('model output is cleaned of fences, subject lines and curly quotes', () => {
  assert.equal(cleanModelOutput('```\nSubject: hi\nHi Jane,\n“x”\n```'), 'Hi Jane,\n"x"');
});
