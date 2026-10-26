/**
 * Minimal .env loader (no dependency): KEY=value lines, # comments, optional
 * quotes. Existing environment variables always win over the file.
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(file = path.resolve(process.cwd(), '.env'), env = process.env) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in env)) env[key] = val;
  }
  return true;
}
