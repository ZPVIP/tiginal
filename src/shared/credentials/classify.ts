import type { Classification, FileFormat, SecretSpan, SecretType } from './types';

/**
 * Deciding which values in a credential file are secret, and what a safe file
 * shows in their place.
 *
 * The unit is a span inside a value, not the whole value. That is what lets a
 * connection string keep everything a developer needs to read while still
 * hiding the one part that matters: `redis://:********@localhost:6379/1`.
 */

export const MASK = '********';
export const FAKE_OPAQUE = 'FAKE_SECRET';

/** A value that is already masked, so a re-import cannot encrypt a mask. */
const ALREADY_MASKED = /^(\*+|FAKE_SECRET|CHANGEME|changeme)$/;

/** A value that names a file rather than being one. */
const PATH_LIKE_VALUE = /^(\/|\.\/|\.\.\/|~\/|[A-Za-z]:[\\/])/;

const URL_WITH_PASSWORD = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^:@/\s]*):([^@/\s]+)@/;

/**
 * Key names that read as secret but are not. Each one is a false positive the
 * table below would otherwise mask, breaking a config that has to stay
 * readable. `_PATH` earns its place twice: the token pattern's `_PAT` branch
 * would match `SSH_KEY_PATH` without it.
 */
export const NON_SECRET_KEY_PATTERNS: RegExp[] = [
  /PUBLIC/i,
  /_PATH$/i,
  /_FILE$/i,
  /_DIR$/i,
  /_URL_SCHEME$/i,
  /_ENABLED$/i,
  /^(?!AWS_ACCESS_KEY_ID$).*_KEY_ID$/i,
];

/** Ordered: the first pattern that matches names the secret's type. */
const SECRET_KEY_PATTERNS: Array<{ type: SecretType; pattern: RegExp }> = [
  { type: 'private_key', pattern: /(PRIVATE_KEY|_PEM|_ID_RSA|_ID_ED25519)$/i },
  { type: 'api_key', pattern: /(API_?KEY|ACCESS_KEY_ID|CLIENT_SECRET)/i },
  { type: 'token', pattern: /(TOKEN|_JWT|_PAT$)/i },
  { type: 'password', pattern: /(PASSWORD|PASSWD|_PWD|SECRET_ACCESS_KEY)/i },
  { type: 'certificate', pattern: /(_CERT|CERTIFICATE)$/i },
  { type: 'generic', pattern: /(SECRET|CREDENTIAL|_DSN|_KEY)$/i },
];

const NOT_SECRET: Classification = { secretType: 'generic', spans: [] };

export function classify(key: string, value: string, format?: FileFormat): Classification {
  if (!value.trim()) return NOT_SECRET;
  if (ALREADY_MASKED.test(value.trim())) return NOT_SECRET;

  // An opaque file has no non-secret structure to preserve. Its path supplies
  // the display name, but the complete file body is the credential regardless
  // of whether that name happens to match a secret-key naming convention.
  if (format === 'opaque') {
    const namedType = SECRET_KEY_PATTERNS.find(({ pattern }) => pattern.test(key))?.type;
    const secretType = value.includes('-----BEGIN') ? 'private_key' : namedType ?? 'generic';
    return { secretType, spans: [whole(value)] };
  }

  const url = URL_WITH_PASSWORD.exec(value);
  if (url) {
    const start = `${url[1]}://${url[2]}:`.length;
    return {
      secretType: 'url_password',
      spans: [{ start, end: start + url[3].length }],
    };
  }

  if (value.includes('-----BEGIN')) {
    return { secretType: 'private_key', spans: [whole(value)] };
  }

  // Keep direct parser callers safe even when they do not pass the format.
  if (key === '' || key === 'WHOLE_FILE') {
    return { secretType: 'generic', spans: [whole(value)] };
  }

  if (NON_SECRET_KEY_PATTERNS.some(pattern => pattern.test(key))) return NOT_SECRET;
  if (PATH_LIKE_VALUE.test(value)) return NOT_SECRET;

  for (const { type, pattern } of SECRET_KEY_PATTERNS) {
    if (pattern.test(key)) return { secretType: type, spans: [whole(value)] };
  }

  return NOT_SECRET;
}

function whole(value: string): SecretSpan {
  return { start: 0, end: value.length };
}

/**
 * The value a safe file shows in place of the real one. A whole-file secret has
 * no surrounding structure to preserve, so it reads as a named placeholder
 * rather than a row of stars.
 */
export function fakeValueFor(
  value: string,
  classification: Classification,
  format: FileFormat,
): string {
  const { spans } = classification;
  if (spans.length === 0) return value;

  const coversEverything =
    spans.length === 1 && spans[0].start === 0 && spans[0].end === value.length;
  if (format === 'opaque' && coversEverything) return FAKE_OPAQUE;

  let masked = value;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    masked = masked.slice(0, span.start) + MASK + masked.slice(span.end);
  }
  return masked;
}

export function isSecret(classification: Classification): boolean {
  return classification.spans.length > 0;
}
