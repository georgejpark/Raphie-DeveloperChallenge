#!/usr/bin/env node
/**
 * Offline stand-in for BOTH external services, so the whole CLI can be run
 * end to end with no network and no API key (CI, demos, reviewing the loop).
 *
 *   node scripts/mock-server.js            # listens on 127.0.0.1:8787
 *   OPENAI_API_KEY=test OPENAI_BASE_URL=http://127.0.0.1:8787/v1 \
 *   GTM_ENDPOINT=http://127.0.0.1:8787/company-analysis \
 *   node src/index.js --name "Jane Doe" --company "Big Bet Sports" --description "..." --tone direct --debug
 *
 * Behaviour
 *   POST /company-analysis   canned payloads by company name:
 *       "Big Bet Sports"  -> operator, US, high volume, KYC high, confidence 0.85   (HIGH tier)
 *       "ApexPay Gaming"  -> payments, crypto, mixed motion, confidence 0.62      (MEDIUM tier)
 *       anything else     -> vague payload, confidence 0.15                        (LOW tier)
 *       name containing "flaky" -> first call 503, then as above (exercises retry)
 *   POST /v1/chat/completions   a tiny template "model" that reads the brief
 *       and returns an email. With MOCK_DIRTY_FIRST=1 the first draft of each
 *       run deliberately breaks three rules so you can watch the redraft loop.
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 8787;
const dirtyFirst = process.env.MOCK_DIRTY_FIRST === '1';
const seen = new Map(); // company -> hits (for the flaky behaviour)
let draftsForRun = 0;

const CANNED = {
  'big bet sports': { vertical: 'igaming', companyType: 'operator', operatingRegions: ['US'], supportMotion: 'high_volume', isCryptoRelated: false, kycAmlIntensity: 'high', confidence: 0.85 },
  'apexpay gaming': { vertical: 'igaming', companyType: 'payments', operatingRegions: ['EU', 'LATAM'], supportMotion: 'mixed', isCryptoRelated: true, kycAmlIntensity: 'high', confidence: 0.62 },
};
const VAGUE = { vertical: 'unknown', companyType: 'unknown', operatingRegions: [], supportMotion: 'unknown', isCryptoRelated: false, kycAmlIntensity: 'unknown', confidence: 0.15 };

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function fakeEmail(userPrompt, dirty) {
  const get = (label) => (userPrompt.match(new RegExp(`- ${label}: (.*)`)) || [])[1] || '';
  const name = (get('Name').split('(')[0] || 'there').trim().split(/\s+/)[0];
  const company = get('Company').trim() || 'your company';
  const warm = /# Tone: warm/.test(userPrompt);
  const kind = (userPrompt.match(/is (a|an) ([^.]*)\. Their audience is ([^.]*)\./) || []);
  const what = kind[2] ? `${kind[1]} ${kind[2]}` : 'a business in the gaming space';
  const who = kind[3] || 'customers';
  const open = warm ? `Hope you're doing well. I'm reaching out from Raphie because we work with support teams across iGaming and sports betting.` : `I'm reaching out from Raphie. We help support teams in iGaming and sports betting automate the repetitive work.`;
  const mid = dirty
    ? `${company} is ${what} — which means ${who} send the same time-sensitive questions every day. Furthermore, that is a fantastic fit for automation! Raphie contains the common cases, guides agents with suggested replies, and keeps escalation paths intact!`
    : `${company} is ${what}, which means ${who} send the same time-sensitive questions every day. That pattern is where automation pays off fastest. Raphie contains the common cases, guides agents with suggested replies, and keeps escalation paths intact for anything sensitive.`;
  const cta = warm ? `Would you be open to a short conversation to see whether this could help?` : `Would you be open to a 15-minute call next week?`;
  return `Hi ${name},\n\n${open}\n\n${mid}\n\n${cta}\n\n${warm ? 'Warm regards' : 'Best'},\nRaphie`;
}

http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.method === 'POST' && req.url === '/company-analysis') {
    let name = '';
    try { name = String(JSON.parse(body).name || ''); } catch { return send(res, 400, { error: 'bad json' }); }
    const key = name.trim().toLowerCase();
    const hits = (seen.get(key) || 0) + 1; seen.set(key, hits);
    if (/flaky/.test(key) && hits === 1) { process.stderr.write(`[mock] /company-analysis "${name}" -> 503 (first call)\n`); return send(res, 503, { error: 'Service Unavailable' }); }
    const data = CANNED[key.replace(/\s*flaky\s*/, '').trim()] || VAGUE;
    process.stderr.write(`[mock] /company-analysis "${name}" -> confidence ${data.confidence}\n`);
    draftsForRun = 0;
    return send(res, 200, data);
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let prompt = '';
    try { prompt = JSON.parse(body).messages.at(-1).content; } catch { return send(res, 400, { error: 'bad json' }); }
    draftsForRun += 1;
    const dirty = dirtyFirst && draftsForRun === 1;
    process.stderr.write(`[mock] /v1/chat/completions draft #${draftsForRun}${dirty ? ' (deliberately dirty)' : ''}\n`);
    return send(res, 200, { id: 'mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: fakeEmail(prompt, dirty) }, finish_reason: 'stop' }] });
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => process.stderr.write(`[mock] listening on http://127.0.0.1:${PORT}  (helper: /company-analysis, openai: /v1/chat/completions)\n`));
