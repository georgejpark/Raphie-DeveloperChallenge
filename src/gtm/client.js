/**
 * Go-to-market helper client.
 *
 * POST { name } -> { vertical, companyType, operatingRegions, supportMotion,
 *                    isCryptoRelated, kycAmlIntensity, confidence }
 *
 * Reliability notes from the brief, and what we do about them:
 *   - "can occasionally take several seconds"  -> per-attempt timeout (AbortController)
 *   - "may return 503 a small percentage"       -> retry 503/429/5xx and network errors
 *                                                  with exponential backoff + jitter
 *   - the helper is an *enhancement*, never a dependency: on final failure we
 *     return { status: 'unavailable' } and the email is generated from the
 *     description alone. The CLI tells the user that happened.
 */

const DEFAULT_ENDPOINT = 'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis';
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export const gtmConfig = () => ({
  endpoint: process.env.GTM_ENDPOINT || DEFAULT_ENDPOINT,
  timeoutMs: Number(process.env.GTM_TIMEOUT_MS) || 8000,
  retries: Number.isFinite(Number(process.env.GTM_RETRIES)) ? Number(process.env.GTM_RETRIES) : 3,
});

/**
 * @param {string} companyName
 * @param {{endpoint?: string, timeoutMs?: number, retries?: number, fetchImpl?: typeof fetch, log?: (msg: string) => void, sleep?: (ms: number) => Promise<void>}} [opts]
 * @returns {Promise<{status: 'ok', data: object, attempts: number} | {status: 'unavailable', reason: string, attempts: number}>}
 */
export async function fetchCompanyAnalysis(companyName, opts = {}) {
  const cfg = { ...gtmConfig(), ...opts };
  const fetchImpl = opts.fetchImpl || fetch;
  const log = opts.log || (() => {});
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = cfg.retries + 1;
  let lastReason = 'unknown';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    try {
      const res = await fetchImpl(cfg.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: companyName }),
        signal: ac.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const problem = validateShape(data);
        if (problem) {
          lastReason = `malformed response: ${problem}`;
          log(`helper attempt ${attempt}: ${lastReason}`);
          break; // a malformed 200 will not fix itself; do not retry
        }
        return { status: 'ok', data: normalize(data), attempts: attempt };
      }
      lastReason = `HTTP ${res.status}`;
      if (!RETRYABLE.has(res.status)) {
        log(`helper attempt ${attempt}: ${lastReason} (not retryable)`);
        break;
      }
      log(`helper attempt ${attempt}: ${lastReason}`);
    } catch (err) {
      lastReason = err?.name === 'AbortError' ? `timeout after ${cfg.timeoutMs} ms` : `network error: ${err?.message || err}`;
      log(`helper attempt ${attempt}: ${lastReason}`);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts) {
      const backoff = Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
      await sleep(backoff);
    }
  }
  return { status: 'unavailable', reason: lastReason, attempts: maxAttempts };
}

function validateShape(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  if (typeof d.confidence !== 'number' || Number.isNaN(d.confidence)) return 'confidence missing or not a number';
  return null;
}

/** Lower-case strings, coerce arrays, clamp confidence; unknown values are kept (interpret.js decides what to do with them). */
function normalize(d) {
  const str = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null);
  return {
    vertical: str(d.vertical),
    companyType: str(d.companyType),
    operatingRegions: Array.isArray(d.operatingRegions) ? d.operatingRegions.map((r) => String(r).trim().toUpperCase()).filter(Boolean) : [],
    supportMotion: str(d.supportMotion),
    isCryptoRelated: d.isCryptoRelated === true,
    kycAmlIntensity: str(d.kycAmlIntensity),
    confidence: Math.min(1, Math.max(0, Number(d.confidence))),
  };
}
