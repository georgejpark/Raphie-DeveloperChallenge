import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchCompanyAnalysis } from '../src/gtm/client.js';

const GOOD = { vertical: 'igaming', companyType: 'operator', operatingRegions: ['US'], supportMotion: 'high_volume', isCryptoRelated: false, kycAmlIntensity: 'high', confidence: 0.85 };
const noSleep = async () => {};

/** Start a throwaway server whose behaviour is a list of per-request handlers. */
function serve(script) {
  let i = 0;
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      const step = script[Math.min(i++, script.length - 1)];
      step(res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/company-analysis` })));
}
const json = (code, obj) => (res) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

test('posts {name} and returns a normalized payload on 200', async () => {
  const { server, seen, url } = await serve([json(200, GOOD)]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 2, sleep: noSleep });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 1);
    assert.deepEqual(seen[0].body, { name: 'Big Bet Sports' });
    assert.equal(seen[0].method, 'POST');
    assert.equal(r.data.companyType, 'operator');
    assert.deepEqual(r.data.operatingRegions, ['US']);
  } finally { server.close(); }
});

test('retries on 503 and succeeds', async () => {
  const { server, url } = await serve([json(503, { error: 'busy' }), json(503, { error: 'busy' }), json(200, GOOD)]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 3, sleep: noSleep });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 3);
  } finally { server.close(); }
});

test('gives up after the retry budget and reports unavailable', async () => {
  const { server, url } = await serve([json(503, {})]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 2, sleep: noSleep });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.attempts, 3);
    assert.match(r.reason, /503/);
  } finally { server.close(); }
});

test('does not retry a 4xx', async () => {
  const { server, seen, url } = await serve([json(400, { error: 'bad' })]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 3, sleep: noSleep });
    assert.equal(r.status, 'unavailable');
    assert.equal(seen.length, 1);
  } finally { server.close(); }
});

test('times out a slow response and retries', async () => {
  const slow = (res) => setTimeout(() => json(200, GOOD)(res), 400);
  const { server, url } = await serve([slow, json(200, GOOD)]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 1, timeoutMs: 100, sleep: noSleep });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 2);
  } finally { server.close(); }
});

test('malformed 200 (no confidence) is treated as unavailable without retry', async () => {
  const { server, seen, url } = await serve([json(200, { vertical: 'igaming' })]);
  try {
    const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: url, retries: 3, sleep: noSleep });
    assert.equal(r.status, 'unavailable');
    assert.match(r.reason, /malformed/);
    assert.equal(seen.length, 1);
  } finally { server.close(); }
});

test('network error (nothing listening) ends as unavailable', async () => {
  const r = await fetchCompanyAnalysis('Big Bet Sports', { endpoint: 'http://127.0.0.1:1/company-analysis', retries: 1, sleep: noSleep });
  assert.equal(r.status, 'unavailable');
  assert.match(r.reason, /network error/);
});
