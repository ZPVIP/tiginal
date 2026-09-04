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
 * value itself. Quotes are excluded from the span so a rewrite keeps whatever
 * quoting style the file already used.
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
        return { value: line.slice(i + 1, j), start: i + 1, end: j };
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

const DETECTION_ORDER: FormatHandler[] = [dotenv, tfvars, opaque];

export function detectFormat(absolutePath: string): FileFormat {
  for (const handler of DETECTION_ORDER) {
    if (handler.matches(absolutePath)) return handler.format;
  }
  return 'opaque';
}

/**
 * Replace the value of every key in `values`, leaving every other byte of the
 * file untouched. Keys absent from the file are reported rather than invented,
 * which is how drift on a renamed or deleted key surfaces.
 */
export function rewriteValues(
  content: string,
  format: FileFormat,
  values: Map<string, string>,
): { content: string; missingKeys: string[] } {
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

  const missingKeys = entries.some(e => e.key === '') && wildcard !== undefined
    ? []
    : [...values.keys()].filter(key => !seen.has(key));

  replacements.sort((a, b) => b.start - a.start);
  let next = content;
  for (const { start, end, text } of replacements) {
    next = next.slice(0, start) + text + next.slice(end);
  }

  return { content: next, missingKeys };
}
