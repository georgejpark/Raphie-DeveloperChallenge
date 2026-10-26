/**
 * Prompt construction.
 *
 * Design goals
 *   1. Give the model a *writer's brief*, not a form to fill: who Raphie is,
 *      who the recipient is, what we know (and how sure we are), and the house
 *      style. The structure of the brief is the same every time; the content
 *      is conditioned on the description + helper analysis (interpret.js).
 *   2. Say the rules in the model's language ("never use an em dash") and
 *      again as a checklist at the end, because recency matters for
 *      compliance. We still validate afterwards; the prompt is the first
 *      layer, not the only one.
 *   3. Separate what the model may *assert* from what it may only *suggest*
 *      (confidence tiers) so a low-information company gets a careful,
 *      outside-in email instead of confident guesses.
 */

export const TONE_GUIDES = {
  direct: {
    opener: 'Get to the point in the first sentence. No "hope you are well". No flattery.',
    voice: 'Plain, confident, specific. Short sentences. Numbers and concrete workflow names over adjectives.',
    cta: 'Ask for a quick 15-minute call next week.',
    signoff: 'Best,',
    length: '110 to 160 words.',
  },
  warm: {
    opener: 'Open with one short, human line (for example "Hope you\'re doing well.") then say why you are writing.',
    voice: 'Friendly and collaborative, still specific. Use "we" and "you" naturally. Avoid gushing.',
    cta: 'Suggest a short conversation and make it easy to say yes.',
    signoff: 'Warm regards,',
    length: '130 to 190 words.',
  },
};

export const STYLE_RULES = [
  'Never use an em dash (—) or an en dash (–). Use a comma, a period, or the word "and" instead.',
  'Never start a sentence with "Furthermore" or "Additionally".',
  'Never use the word "fantastic".',
  'Use at most one exclamation mark in the whole email, and preferably none.',
  'No two consecutive sentences may start with the same word (this includes "I", "We", "Raphie", and the greeting line).',
  'No sentence may be longer than 30 words. Split long ideas into two sentences.',
  'No bullet points, no headings, no subject line, no placeholders, no markdown.',
  'Do not mention AI, automation vendors, or that this email was generated.',
  'Do not invent numbers, customers, or facts about the recipient that are not in the brief.',
];

export function systemPrompt() {
  return [
    'You write cold outreach emails on behalf of Raphie, a customer service automation company.',
    'Raphie helps support teams in iGaming and sports betting (operators, B2B suppliers, affiliates, payments, risk, data, compliance) automate support workflows, improve resolution time, deflect repetitive tickets, and help human agents with suggested replies and clean handoffs.',
    'You write like an experienced sales engineer who understands the recipient\'s business: concrete, calm, specific, human. The reader must never suspect the email was machine-written.',
    'Output only the email body, starting with the greeting line and ending with the sign-off and the name "Raphie". No subject line, no commentary.',
  ].join('\n');
}

/**
 * @param {{recipientName: string, companyName: string, description: string, tone: 'direct'|'warm'}} input
 * @param {ReturnType<import('../gtm/interpret.js').buildConditioning>} cond
 * @param {{violations?: Array<{rule: string, detail: string}>, previous?: string}} [feedback]
 */
export function userPrompt(input, cond, feedback = {}) {
  const tone = TONE_GUIDES[input.tone];
  const firstName = input.recipientName.trim().split(/\s+/)[0];
  const lines = [];

  lines.push('# Recipient');
  lines.push(`- Name: ${input.recipientName} (address them as "${firstName}")`);
  lines.push(`- Company: ${input.companyName}`);
  lines.push(`- Description provided by our team: ${input.description}`);

  lines.push('', '# What we know about the company');
  if (cond.playbook) {
    const how = cond.typeSource === 'description' || cond.tier === 'high' ? 'We know' : 'It appears';
    lines.push(`- ${how} ${input.companyName} is ${cond.playbook.label}. Their audience is ${cond.playbook.audience}.`);
  } else {
    lines.push('- We do not know what kind of company this is beyond the description. Do not guess a company type; speak to the support challenges the description implies.');
  }
  if (cond.painPoints.length) lines.push(`- Support themes named in the description: ${cond.painPoints.join('; ')}.`);

  const facts = cond.angles.filter((a) => a.assert);
  const hints = cond.angles.filter((a) => !a.assert);
  if (facts.length) {
    lines.push('- Facts you may state plainly:');
    for (const a of facts) lines.push(`  - ${a.text}`);
  }
  if (hints.length) {
    lines.push('- Likely but unconfirmed. You may use these only in hedged, outside-in language ("from the outside, it looks like..."), never as fact:');
    for (const a of hints) lines.push(`  - ${a.text}`);
  }
  if (!cond.helperUsed) {
    lines.push('- We have no verified market data on this company. Stay close to the description; do not assert regions, licences, or volumes.');
  }

  lines.push('', '# What the email must do, in this order');
  lines.push(`1. Greet ${firstName} by first name.`);
  lines.push('2. Say you are reaching out from Raphie and why, in one or two sentences.');
  lines.push(`3. Show you understand ${input.companyName}'s world: why their kind of business and the themes above create repetitive, time-sensitive support work. This is the commentary on why their space is a strong candidate for automation. Be specific to them, not generic.`);
  lines.push(`4. State Raphie's value clearly: ${cond.playbook ? cond.playbook.pitch : 'automating repetitive support workflows, improving resolution time, deflecting repetitive tickets, and helping agents with suggested replies and clean handoffs'}.`);
  lines.push(`5. ${tone.cta}`);
  lines.push(`6. Sign off with "${tone.signoff}" on its own line, then "Raphie" on the next line.`);

  lines.push('', '# Tone: ' + input.tone);
  lines.push(`- ${tone.opener}`);
  lines.push(`- ${tone.voice}`);
  lines.push(`- Length: ${tone.length} Three short paragraphs plus greeting and sign-off.`);

  lines.push('', '# House style (hard rules, checked automatically)');
  for (const r of STYLE_RULES) lines.push(`- ${r}`);

  if (feedback.violations?.length) {
    lines.push('', '# Your previous draft broke these rules. Rewrite the whole email and fix every one:');
    for (const v of feedback.violations) lines.push(`- ${v.detail}`);
    if (feedback.previous) lines.push('', 'Previous draft for reference:', feedback.previous);
  }

  lines.push('', 'Before you answer, silently check every sentence against the house style. Then output only the email.');
  return lines.join('\n');
}
