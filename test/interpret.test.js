import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConditioning, confidenceTier, analyzeDescription, CONFIDENCE_HIGH, CONFIDENCE_LOW } from '../src/gtm/interpret.js';
import { userPrompt } from '../src/email/prompt.js';

const helperOk = (data) => ({ status: 'ok', data: { vertical: 'igaming', companyType: 'operator', operatingRegions: ['US'], supportMotion: 'high_volume', isCryptoRelated: false, kycAmlIntensity: 'high', confidence: 0.85, ...data } });

test('confidence tiers', () => {
  assert.equal(confidenceTier(0.85), 'high');
  assert.equal(confidenceTier(CONFIDENCE_HIGH), 'high');
  assert.equal(confidenceTier(0.55), 'medium');
  assert.equal(confidenceTier(CONFIDENCE_LOW), 'medium');
  assert.equal(confidenceTier(0.15), 'low');
});

test('description classifier picks up type, crypto, KYC, volume, regions, pain points', () => {
  const a = analyzeDescription('A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps, and handles a high volume of payout status and fraud review tickets from operators in the US and Brazil');
  assert.equal(a.companyType, 'payments');
  assert.equal(a.crypto, true);
  assert.equal(a.highVolume, true);
  assert.deepEqual(a.regions, ['US', 'LATAM']);
  assert.ok(a.painPoints.includes('withdrawals and payout status'));
  assert.ok(a.painPoints.includes('fraud and risk reviews'));
});

test('HIGH confidence: helper fields become facts (regions asserted)', () => {
  const c = buildConditioning({ description: 'A sportsbook with lots of tickets' }, helperOk({ confidence: 0.85 }));
  assert.equal(c.tier, 'high');
  assert.equal(c.helperUsed, true);
  assert.equal(c.companyType, 'operator');
  const region = c.angles.find((a) => a.key === 'region:US');
  assert.ok(region && region.assert === true);
  const kyc = c.angles.find((a) => a.key === 'kyc');
  assert.ok(kyc && kyc.assert === true);
});

test('MEDIUM confidence: helper fields are hints, regions dropped', () => {
  const c = buildConditioning({ description: 'A company with lots of tickets' }, helperOk({ confidence: 0.55 }));
  assert.equal(c.tier, 'medium');
  assert.equal(c.companyType, 'operator');          // filled from helper because description had none
  assert.equal(c.typeSource, 'helper (medium)');
  assert.ok(!c.angles.some((a) => a.key.startsWith('region:')));
  assert.ok(c.angles.every((a) => a.assert === false));
  const p = userPrompt({ recipientName: 'Jane Doe', companyName: 'X', description: 'A company with lots of tickets', tone: 'warm' }, c);
  assert.match(p, /It appears X is/);
  assert.match(p, /Likely but unconfirmed/);
});

test('LOW confidence: helper is discarded, email written from description alone', () => {
  const c = buildConditioning({ description: 'A company with lots of tickets' }, helperOk({ confidence: 0.15 }));
  assert.equal(c.tier, 'low');
  assert.equal(c.helperUsed, false);
  assert.equal(c.companyType, null);
  assert.deepEqual(c.angles, []);
  const p = userPrompt({ recipientName: 'Jane Doe', companyName: 'X', description: 'A company with lots of tickets', tone: 'direct' }, c);
  assert.match(p, /no verified market data/);
});

test('helper unavailable behaves like LOW', () => {
  const c = buildConditioning({ description: 'An affiliate comparison site with commission disputes' }, { status: 'unavailable', reason: 'HTTP 503' });
  assert.equal(c.tier, 'none');
  assert.equal(c.companyType, 'affiliate');       // description still works
  assert.ok(c.angles.find((a) => a.key === 'type').assert === true);
});

test('description beats a contradicting helper', () => {
  const c = buildConditioning({ description: 'An affiliate network that runs comparison sites for sportsbooks' }, helperOk({ companyType: 'operator', confidence: 0.6 }));
  assert.equal(c.companyType, 'affiliate');
  assert.ok(c.notes.some((n) => /description wins/.test(n)));
  assert.ok(!c.angles.some((a) => a.key === 'kyc'), 'KYC intensity is noise for an affiliate');
});

test('never more than three angles, company type first', () => {
  const c = buildConditioning({ description: 'A US and UK sportsbook operator with crypto deposits, KYC backlogs and game-day spikes' }, helperOk({ confidence: 0.9, operatingRegions: ['US', 'UK', 'EU'] }));
  assert.equal(c.angles.length, 3);
  assert.equal(c.angles[0].key, 'type');
});
