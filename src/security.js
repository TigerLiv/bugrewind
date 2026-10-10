import crypto from 'node:crypto';

export const short = (v, n = 220) => String(v ?? '').slice(0, n);
export function redact(input) {
  return short(input, 2000)
    .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/\b(?:Bearer\s+)?(?:sk-[\w-]+|gh[pousr]_[\w-]+)\b/gi, '[token]')
    .replace(/(authorization|cookie|password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*(?:Bearer\s+)?[^\s,;&]+/gi, '$1=[redacted]');
}
export function safeDetail(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redact(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 12).map(x => safeDetail(x, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const [key, val] of Object.entries(value).slice(0, 30)) {
    if (/pass|token|auth|cookie|secret|email|name|phone|input|value|html|body|response|query/i.test(key)) continue;
    out[short(key, 48)] = safeDetail(val, depth + 1);
  }
  return out;
}
export function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), {status});
}
export function id() { return crypto.randomUUID(); }
export function fingerprint(kind, message) {
  const normalized = String(message || '').toLowerCase().replace(/\d+/g, '#').replace(/[a-f0-9]{8,}/g, '*').slice(0, 280);
  return crypto.createHash('sha256').update(kind + '|' + normalized).digest('hex').slice(0, 28);
}
export function validId(s) { return typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s); }
export function validUuid(s) { return typeof s === 'string' && /^[a-f0-9-]{36}$/i.test(s); }
