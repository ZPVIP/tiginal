import type { FileFormat, ParsedEntry } from './types';

/**
 * Locating values inside the credential file formats Tiginal manages.
 *
 * Every handler only has to find where values live. Rewriting is one shared
 * span-driven function, so the file keeps its comments, ordering, quoting, and
 * line endings byte-for-byte and a new format costs a parser and nothing else.
 */

export interface FormatHandler {
  format: FileFormat;
  parse(content: string): ParsedEntry[];
  matches(absolutePath: string): boolean;
}

const DOTENV_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const TFVARS_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * `null` for `opaque`, which has no key syntax: its one entry is the whole
 * file, named after its path rather than by anything inside it.
 */
const KEY_PATTERNS: Record<FileFormat, RegExp | null> = {
  dotenv: DOTENV_KEY,
  tfvars: TFVARS_KEY,
  opaque: null,
};

/**
 * Whether a key the user typed is one this format's parser would read back. An
 * editor that accepted a name the parser skips would store a secret that never
 * appears in the file again.
 */
export function isValidKeyName(format: FileFormat, key: string): boolean {
  const pattern = KEY_PATTERNS[format];
  return pattern !== null && pattern.test(key);
}

/** Suffixes stripped when a whole-file secret is named after its basename. */
const OPAQUE_SUFFIXES = ['.key', '.pem', '.txt', '.secret'];

function basename(absolutePath: string): string {
  const cut = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'));
  return cut === -1 ? absolutePath : absolutePath.slice(cut + 1);
}

/**
 * The entry name for a whole-file secret. A Kamal key file carries its own name
 * in its basename: `.kamal/keys/KAMAL_REGISTRY_PASSWORD.key`.
 */
export function opaqueKeyFromPath(absolutePath: string): string {
  let name = basename(absolutePath);
  for (const suffix of OPAQUE_SUFFIXES) {
    if (name.toLowerCase().endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name || 'SECRET';
}

/** Each line of `content` with the offset at which it starts. */
function eachLine(content: string): Array<{ text: string; offset: number }> {
  const lines: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  while (offset <= content.length) {
    const next = content.indexOf('\n', offset);
    const end = next === -1 ? content.length : next;
    lines.push({ text: content.slice(offset, end), offset });
    if (next === -1) break;
    offset = next + 1;
  }
  return lines;
}

/**
 * Read a value that starts at `from` within `line`, returning the span of the
 * value itself. Quotes are part of the span: a quoted value is stored and
 * restored with its quotes, so a rewrite cannot change what the shell reads.
 */
function readValue(
  line: string,
  from: number,
  allowSlashComment: boolean,
): { value: string; start: number; end: number } | null {
  let i = from;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;

  const quote = line[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < line.length) {
      if (line[j] === '\\' && quote === '"') {
        j += 2;
        continue;
      }
      if (line[j] === quote) {
        return { value: line.slice(i, j + 1), start: i, end: j + 1 };
      }
      j += 1;
    }
    // An unterminated quote is a malformed line; leave it alone entirely.
    return null;
  }

  let end = line.length;
  for (let j = i; j < line.length; j += 1) {
    const isHash = line[j] === '#';
    const isSlash = allowSlashComment && line[j] === '/' && line[j + 1] === '/';
    if ((isHash || isSlash) && (j === i || line[j - 1] === ' ' || line[j - 1] === '\t')) {
      end = j;
      break;
    }
  }
  while (end > i && /[\s]/.test(line[end - 1])) end -= 1;
  if (end <= i) return null;
  return { value: line.slice(i, end), start: i, end };
}

const dotenv: FormatHandler = {
  format: 'dotenv',
  matches(absolutePath) {
    const name = basename(absolutePath);
    return name === '.env' || name.startsWith('.env.');
  },
  parse(content) {
    const entries: ParsedEntry[] = [];
    for (const { text, offset } of eachLine(content)) {
      const trimmed = text.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const lead = text.length - trimmed.length;
      const withoutExport = trimmed.startsWith('export ')
        ? { text: trimmed.slice(7), extra: 7 }
        : { text: trimmed, extra: 0 };

      const eq = withoutExport.text.indexOf('=');
      if (eq === -1) continue;

      const key = withoutExport.text.slice(0, eq).trim();
      if (!DOTENV_KEY.test(key)) continue;

      const valueFrom = lead + withoutExport.extra + eq + 1;
      const read = readValue(text, valueFrom, false);
      if (!read) continue;

      entries.push({
        key,
        value: read.value,
        valueStart: offset + read.start,
        valueEnd: offset + read.end,
      });
    }
    return entries;
  },
};

const tfvars: FormatHandler = {
  format: 'tfvars',
  matches(absolutePath) {
    const name = basename(absolutePath).toLowerCase();
    return name.endsWith('.tfvars') || name.endsWith('.auto.tfvars');
  },
  parse(content) {
    const entries: ParsedEntry[] = [];
    for (const { text, offset } of eachLine(content)) {
      const trimmed = text.trimStart();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      const eq = text.indexOf('=');
      if (eq === -1) continue;

      const key = text.slice(0, eq).trim();
      if (!TFVARS_KEY.test(key)) continue;

      const read = readValue(text, eq + 1, true);
      if (!read) continue;
      // A block, list, map, or heredoc value is structure, not a scalar secret.
      if (/^[{[]|^<</.test(read.value)) continue;

      entries.push({
        key,
        value: read.value,
        valueStart: offset + read.start,
        valueEnd: offset + read.end,
      });
    }
    return entries;
  },
};

const opaque: FormatHandler = {
  format: 'opaque',
  matches() {
    return true;
  },
  parse(content) {
    let end = content.length;
    if (content.endsWith('\r\n')) end -= 2;
    else if (content.endsWith('\n')) end -= 1;
    if (end === 0) return [];
    // The name of a whole-file secret comes from its path, which a parser over
    // content alone cannot see. An empty key means "the whole file"; see
    // `rewriteValues` and `opaqueKeyFromPath`.
    return [{ key: '', value: content.slice(0, end), valueStart: 0, valueEnd: end }];
  },
};

export const FORMAT_HANDLERS: Record<FileFormat, FormatHandler> = {
  dotenv,
  tfvars,
  opaque,
};

/**
 * How a key Tiginal manages but the file no longer contains is written back.
 * `null` means the format has no line to append to: an opaque file is one
 * nameless value, so a key that is missing from it is the whole file missing.
 */
const APPEND_LINE: Record<FileFormat, ((key: string, value: string) => string) | null> = {
  dotenv: (key, value) => `${key}=${value}`,
  tfvars: (key, value) => `${key} = ${value}`,
  opaque: null,
};

const DETECTION_ORDER: FormatHandler[] = [dotenv, tfvars, opaque];

export function detectFormat(absolutePath: string): FileFormat {
  for (const handler of DETECTION_ORDER) {
    if (handler.matches(absolutePath)) return handler.format;
  }
  return 'opaque';
}

/**
 * The form a value typed in the UI has to take on disk, or null when the
 * format cannot carry it at all.
 *
 * A bare value is not always safe: ` #` starts a comment, trailing whitespace
 * is trimmed, and a leading quote opens a quoted value the parser may never
 * see closed, so storing what the user typed would let the next mask cycle
 * read the secret back short. The candidates are checked by parsing them, so
 * the answer is defined by the reader in this file rather than by a second
 * copy of its rules that could drift away from it.
 */
export function storableValue(format: FileFormat, value: string): string | null {
  const write = APPEND_LINE[format];
  if (write === null) return value;

  for (const candidate of [value, `"${value}"`, `'${value}'`]) {
    const line = write('TIGINAL_PROBE', candidate);
    const parsed = FORMAT_HANDLERS[format].parse(`${line}\n`);
    if (parsed.some(entry => entry.key === 'TIGINAL_PROBE' && entry.value === candidate)) {
      return candidate;
    }
  }
  return null;
}

export interface RewriteOptions {
  /**
   * Append a line for every key that is missing from the file. Tiginal owns
   * the set of managed keys, so a key deleted from the file by hand comes back
   * on the next write rather than silently dropping out of the credential set.
   */
  appendMissing?: boolean;
}

export interface RewriteResult {
  content: string;
  /** Keys the file does not contain and that were not appended. */
  missingKeys: string[];
  appendedKeys: string[];
}

/**
 * Replace the value of every key in `values`, leaving every other byte of the
 * file untouched. Comments, ordering, quoting and non-managed lines survive
 * because each replacement is a splice over one recorded span, never a rebuild
 * of the file.
 */
export function rewriteValues(
  content: string,
  format: FileFormat,
  values: Map<string, string>,
  options: RewriteOptions = {},
): RewriteResult {
  const entries = FORMAT_HANDLERS[format].parse(content);
  const wildcard = [...values.values()][0];

  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const replacement = entry.key === '' ? wildcard : values.get(entry.key);
    if (replacement === undefined) continue;
    if (entry.key !== '') seen.add(entry.key);
    replacements.push({ start: entry.valueStart, end: entry.valueEnd, text: replacement });
  }

  const wholeFileCovered = entries.some(e => e.key === '') && wildcard !== undefined;
  const absent = wholeFileCovered
    ? []
    : [...values.keys()].filter(key => !seen.has(key));

  replacements.sort((a, b) => b.start - a.start);
  let next = content;
  for (const { start, end, text } of replacements) {
    next = next.slice(0, start) + text + next.slice(end);
  }

  const line = APPEND_LINE[format];
  if (!options.appendMissing || line === null || absent.length === 0) {
    return { content: next, missingKeys: absent, appendedKeys: [] };
  }

  const eol = next.includes('\r\n') ? '\r\n' : '\n';
  const head = next.length === 0 || next.endsWith('\n') ? next : next + eol;
  const appended = absent.map(key => line(key, values.get(key) as string) + eol).join('');

  return { content: head + appended, missingKeys: [], appendedKeys: absent };
}
