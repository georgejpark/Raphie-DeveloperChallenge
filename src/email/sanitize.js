/**
 * Deterministic, meaning-preserving repairs for the mechanical rules.
 *
 * Strategy: ask the model to comply, validate, and if it slips, prefer a
 * regeneration with the violations fed back. Sanitizing is the last line of
 * defence for the rules that can be fixed safely without changing meaning:
 *   - em dash  -> comma (or a period if it separates two clauses that can stand alone is risky, so we use ", ")
 *   - "Furthermore, " / "Additionally, " at sentence start -> dropped
 *   - "fantastic" -> "great"
 *   - 2nd..nth exclamation marks -> periods
 *   - en dashes / double hyphens -> comma (not banned, but they read as AI-ish too)
 * Sentence length and repeated starters are NOT fixed here: rewriting
 * sentences mechanically produces worse prose than asking the model again.
 */

export function sanitizeEmail(email) {
  let out = email;

  // em dash, en dash, double hyphen used as a dash -> comma
  out = out.replace(/\s*—\s*/g, ', ');
  out = out.replace(/\s+–\s+/g, ', ');
  out = out.replace(/\s+--\s+/g, ', ');

  // banned sentence starters (start of text, after a line break, or after . ! ?)
  out = out.replace(/(^|[\n.!?]\s*)(Furthermore|Additionally),?\s+(\w)/g, (_, pre, _w, next) => `${pre}${next.toUpperCase()}`);

  // banned word
  out = out.replace(/\bfantastic\b/gi, 'great');

  // keep only the first exclamation mark
  let seen = 0;
  out = out.replace(/!/g, () => (seen++ === 0 ? '!' : '.'));

  // tidy double punctuation / spaces created above
  out = out.replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').replace(/[ \t]{2,}/g, ' ');
  return out.trim();
}
