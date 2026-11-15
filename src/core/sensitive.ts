/**
 * Detects text that looks like a credential or payment detail. OmniMemory is
 * for context, not secrets: anything saved here may be pasted into a chatbot.
 *
 * Capture paths (page selection, on-page panel, import) refuse flagged text.
 * Manual entry shows the warning and requires an explicit override.
 */

export interface SensitiveFinding {
  kind: 'password' | 'api-key' | 'token' | 'private-key' | 'card-number' | 'ssn';
  label: string;
}

const PATTERNS: { kind: SensitiveFinding['kind']; label: string; regex: RegExp }[] = [
  {
    kind: 'private-key',
    label: 'a private key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    kind: 'password',
    label: 'a password',
    regex: /\b(pass(word|code|phrase)?|passwd|pwd|pin)\b\s*(is|[:=])\s*\S{3,}/i,
  },
  {
    kind: 'api-key',
    label: 'an API key',
    regex:
      /\b(sk-[A-Za-z0-9_-]{16,}|sk_(live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/,
  },
  {
    kind: 'api-key',
    label: 'an API key or secret',
    regex: /\b(api[_ -]?key|secret|access[_ -]?token|auth[_ -]?token|bearer)\b\s*(is|[:=])?\s*["']?[A-Za-z0-9_\-./+]{16,}/i,
  },
  {
    kind: 'token',
    label: 'an authentication token',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    kind: 'ssn',
    label: 'a social security number',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
  },
];

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsCardNumber(text: string): boolean {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
}

export function findSensitive(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const seen = new Set<string>();
  for (const { kind, label, regex } of PATTERNS) {
    if (regex.test(text) && !seen.has(kind)) {
      seen.add(kind);
      findings.push({ kind, label });
    }
  }
  if (containsCardNumber(text)) findings.push({ kind: 'card-number', label: 'a payment card number' });
  return findings;
}

export function describeSensitive(findings: SensitiveFinding[]): string {
  if (findings.length === 0) return '';
  return `This looks like it contains ${findings.map((f) => f.label).join(' and ')}.`;
}
