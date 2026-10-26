/**
 * Turn the helper response + the user's description into a small set of
 * "angles" the email can be built around.
 *
 * ---------------------------------------------------------------------------
 * Confidence policy (the brief asks us to document the reasoning)
 * ---------------------------------------------------------------------------
 * The helper's `confidence` says how much it actually knows about *this*
 * company. A cold email that asserts a wrong fact ("as a US-facing operator")
 * is worse than one that says nothing, because the recipient knows their own
 * business and spots the error instantly. So the question is not "do we use
 * the data" but "how strongly may the email lean on it":
 *
 *   confidence >= 0.70  HIGH    The fields are treated as facts the writer
 *                               knows. The email may reference them plainly
 *                               (company type, regions, KYC load, crypto).
 *   0.40 <= c < 0.70    MEDIUM  Fields are used as *hints*: the email may
 *                               reference them only in hedged, outside-in
 *                               language ("from the outside, X looks like...")
 *                               and only where they do not contradict the
 *                               user's description. Regions are dropped at
 *                               this tier because a wrong region is the most
 *                               embarrassing mistake to make.
 *   c < 0.40            LOW     The payload is discarded for conditioning.
 *                               The email is written from the description
 *                               alone, exactly as if the helper were down.
 *                               We still log what the helper said (--debug)
 *                               so a human can judge it.
 *
 * 0.40 / 0.70 are judgment calls, not magic: below ~0.4 the helper is closer
 * to guessing than knowing; above ~0.7 it is confident enough that stating a
 * fact outright is a reasonable risk for a cold email. Both are constants so
 * they can be tuned once we see real precision data.
 *
 * ---------------------------------------------------------------------------
 * The description always wins
 * ---------------------------------------------------------------------------
 * The person typing the description has first-hand context. If it clearly
 * says "affiliate" and the helper says "operator" at 0.55, we go with the
 * description. A simple keyword classifier extracts what the description
 * already tells us; the helper fills gaps rather than overriding.
 */

export const CONFIDENCE_HIGH = 0.7;
export const CONFIDENCE_LOW = 0.4;

export function confidenceTier(confidence) {
  if (confidence >= CONFIDENCE_HIGH) return 'high';
  if (confidence >= CONFIDENCE_LOW) return 'medium';
  return 'low';
}

/* ----------------------------- description NLP ---------------------------- */

const TYPE_PATTERNS = [
  ['affiliate', /\baffiliat|\bmedia (site|brand)|\bcomparison site|\bpublisher/i],
  ['payments', /\bpayment|\bpsp\b|\bpayout|\bon-?ramp|\bacquir|\bwallet provider|\bcashier/i],
  ['risk_compliance', /\bkyc provider|\baml provider|\bfraud (prevention|detection) (vendor|provider|platform)|\bcompliance (vendor|provider|platform)|\brisk (vendor|platform|provider)/i],
  ['data', /\bodds feed|\bdata (provider|feed|supplier)|\btrading data|\bpricing feed/i],
  ['b2b_supplier', /\bb2b\b|\bplatform provider|\bwhite[- ]label|\bturnkey|\bgame (studio|provider|supplier)|\bsupplier|\baggregator|\bsportsbook platform|\bpam\b/i],
  ['operator', /\boperator|\bsportsbook\b|\bcasino\b|\bbookmaker|\bbetting (site|brand|app)|\blottery|\bpoker room|\bbingo/i],
];

export function analyzeDescription(description = '') {
  const d = description || '';
  let type = null;
  for (const [t, re] of TYPE_PATTERNS) {
    if (re.test(d)) { type = t; break; }
  }
  return {
    companyType: type,
    crypto: /\bcrypto|\bbitcoin|\bstablecoin|\busdt|\bweb3|\bon-?chain|\bblockchain/i.test(d),
    kycHeavy: /\bkyc|\baml|\bverification|\bidentity|\bdocument review|\bsource of funds/i.test(d),
    highVolume: /\bhigh[- ]volume|\bspikes?\b|\bsurge|\bpeak|\bgame[- ]day|\bthousands|\bmillions|\bbacklog/i.test(d),
    regions: extractRegions(d),
    painPoints: extractPainPoints(d),
  };
}

function extractRegions(d) {
  const found = [];
  const pairs = [
    ['US', /\b(us|u\.s\.|usa|united states|new jersey|pennsylvania|michigan|ontario)\b/i],
    ['UK', /\b(uk|u\.k\.|united kingdom|ukgc|britain)\b/i],
    ['EU', /\b(eu|europe|malta|mga|germany|italy|spain|netherlands|sweden)\b/i],
    ['LATAM', /\b(latam|latin america|brazil|brasil|mexico|colombia|argentina|peru)\b/i],
    ['AFRICA', /\b(africa|nigeria|kenya|south africa|ghana)\b/i],
    ['ASIA', /\b(asia|philippines|india|japan)\b/i],
    ['AU', /\b(australia|aus)\b/i],
  ];
  for (const [r, re] of pairs) if (re.test(d)) found.push(r);
  return found;
}

function extractPainPoints(d) {
  const map = [
    ['withdrawals and payout status', /withdraw|payout|cash ?out/i],
    ['KYC and verification', /kyc|verif|identity|document/i],
    ['promo and bonus eligibility', /promo|bonus|free bet|eligib/i],
    ['account access and login', /account access|login|locked|password/i],
    ['fraud and risk reviews', /fraud|risk review|chargeback/i],
    ['responsible gambling requests', /responsible|self-?exclu|limit/i],
    ['integration and technical tickets', /integration|api|technical|sdk|outage/i],
    ['tracking and commission disputes', /tracking|commission|attribution|postback/i],
    ['game-day and event spikes', /game day|big game|match day|event|spike|surge|peak/i],
  ];
  return map.filter(([, re]) => re.test(d)).map(([label]) => label);
}

/* ------------------------------ field playbook ---------------------------- */

const TYPE_PLAYBOOK = {
  operator: {
    label: 'a B2C operator (sportsbook / casino)',
    audience: 'players',
    shape: 'player-facing volume: withdrawals, verification, bonus eligibility, account access, and spikes around big events',
    pitch: 'fast containment for repetitive player questions, policy-aware replies, clean escalation for sensitive cases',
  },
  b2b_supplier: {
    label: 'a B2B supplier / platform serving operators',
    audience: 'operator clients and their teams',
    shape: 'operator-facing tickets: integration questions, incident and status updates, configuration changes, SLA-bound requests',
    pitch: 'tier-1 triage and faster first response, consistent answers from documentation, agents freed for the complex cases',
  },
  affiliate: {
    label: 'an affiliate / media business',
    audience: 'partners, operators, and readers',
    shape: 'lower volume but messy: tracking and commission questions, partner onboarding, content and compliance requests',
    pitch: 'agent assist and faster resolution rather than mass deflection; keep partner relationships personal',
  },
  payments: {
    label: 'a payments provider for the gaming ecosystem',
    audience: 'operators and end users',
    shape: 'two-sided demand: operators needing fast answers, and players asking about payout status, settlement timing, and declined transactions',
    pitch: 'automate status and timing questions, guide agents on fraud and review cases, keep approvals and audit trails intact',
  },
  risk_compliance: {
    label: 'a risk / compliance vendor',
    audience: 'operator compliance and support teams',
    shape: 'case-heavy work: document review follow-ups, policy clarifications, escalations with audit requirements',
    pitch: 'structured intake, consistent policy-aware responses, and escalation paths that preserve auditability',
  },
  data: {
    label: 'a data / odds / trading supplier',
    audience: 'operator trading and integration teams',
    shape: 'technical, time-sensitive tickets: feed issues, latency, settlement disputes',
    pitch: 'faster triage and status communication, agents guided by runbooks, fewer repeat questions',
  },
};

const REGION_NOTES = {
  US: 'state-by-state US requirements (geolocation, responsible gaming, tax forms) that add complexity to support',
  UK: 'UKGC expectations around affordability checks and safer gambling interactions',
  EU: 'multi-jurisdiction European licensing and multilingual support needs',
  LATAM: 'fast-growing LATAM markets (for example Brazil) with local payment rails and Portuguese or Spanish support',
  AFRICA: 'mobile-first African markets with mobile money and USSD-driven support questions',
  ASIA: 'high-volume Asian markets with multilingual and messaging-app support expectations',
  AU: 'Australian regulatory expectations around responsible gambling',
};

/**
 * Merge the description analysis and the helper response into a conditioning
 * object the prompt builder can turn into instructions.
 *
 * @param {{description: string}} input
 * @param {{status: string, data?: object}} helper   result of fetchCompanyAnalysis
 */
export function buildConditioning(input, helper) {
  const desc = analyzeDescription(input.description);
  const usable = helper?.status === 'ok' ? helper.data : null;
  const tier = usable ? confidenceTier(usable.confidence) : 'none';
  const h = tier === 'low' || tier === 'none' ? null : usable; // LOW -> discard for conditioning
  const notes = [];

  // company type: description first, then helper (HIGH or MEDIUM)
  let companyType = desc.companyType;
  let typeSource = companyType ? 'description' : null;
  if (!companyType && h?.companyType && TYPE_PLAYBOOK[canonicalType(h.companyType)]) {
    companyType = canonicalType(h.companyType);
    typeSource = `helper (${tier})`;
  } else if (companyType && h?.companyType && canonicalType(h.companyType) !== companyType) {
    notes.push(`helper says "${h.companyType}" but description reads as "${companyType}"; description wins`);
  }

  // regions: description always; helper only at HIGH confidence
  const regions = new Set(desc.regions);
  if (tier === 'high') for (const r of h.operatingRegions || []) if (REGION_NOTES[r]) regions.add(r);

  const crypto = desc.crypto || (h?.isCryptoRelated === true);
  const kycHeavy = desc.kycHeavy || h?.kycAmlIntensity === 'high';
  const highVolume = desc.highVolume || h?.supportMotion === 'high_volume';
  const vertical = h?.vertical || null;

  const playbook = companyType ? TYPE_PLAYBOOK[companyType] : null;

  // Angles, in priority order. Company type first (it sets the whole frame),
  // then the most distinctive signals (crypto, region), then KYC, then volume.
  // The playbook text for each type already mentions volume patterns, so the
  // volume angle is the first to be dropped when we have richer signals.
  const angles = [];
  if (playbook) angles.push({ key: 'type', text: `${playbook.shape}`, assert: typeSource === 'description' || tier === 'high' });
  if (crypto) angles.push({ key: 'crypto', text: 'crypto rails add wallet, confirmation-time, and AML questions that players ask about repeatedly', assert: desc.crypto || tier === 'high' });
  const [firstRegion] = [...regions]; // one region is plenty for a cold email
  if (firstRegion) angles.push({ key: `region:${firstRegion}`, text: REGION_NOTES[firstRegion], assert: desc.regions.includes(firstRegion) || tier === 'high' });
  if (kycHeavy && companyType !== 'affiliate') angles.push({ key: 'kyc', text: 'verification and KYC follow-ups are a steady source of repeat, time-sensitive tickets', assert: desc.kycHeavy || tier === 'high' });
  if (highVolume) angles.push({ key: 'volume', text: 'volume comes in spikes, so containment of common questions and consistent replies matter most', assert: desc.highVolume || tier === 'high' });
  else if (companyType && (h?.supportMotion === 'low_volume' || companyType === 'affiliate')) angles.push({ key: 'assist', text: 'volume is moderate, so the win is agent assist and resolution time rather than mass deflection', assert: tier === 'high' || companyType === 'affiliate' });

  // keep the email focused: at most 3 angles, type first
  const chosen = angles.slice(0, 3);

  return {
    tier,
    helperUsed: Boolean(h),
    helperRaw: usable,
    companyType,
    typeSource,
    playbook,
    vertical,
    painPoints: desc.painPoints,
    regions: [...regions],
    crypto,
    kycHeavy,
    highVolume,
    angles: chosen,
    notes,
  };
}

function canonicalType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (/operator|sportsbook|casino|b2c/.test(s)) return 'operator';
  if (/affiliate|media|publisher/.test(s)) return 'affiliate';
  if (/payment|psp|wallet/.test(s)) return 'payments';
  if (/risk|compliance|kyc|fraud/.test(s)) return 'risk_compliance';
  if (/data|odds|feed|trading/.test(s)) return 'data';
  if (/b2b|supplier|platform|provider|vendor|studio|aggregator/.test(s)) return 'b2b_supplier';
  return null;
}
