/**
 * Utility functions for joining text tokens cleanly and suppressing ASR hallucination loops.
 */

/**
 * Joins two text tokens while maintaining proper whitespace:
 * - Inserts a space between consecutive Latin/alphanumeric words (e.g. "Start" + "Busy" -> "Start Busy")
 * - Handles English punctuation spacing (e.g. "meeting," + "so" -> "meeting, so", "done." + "Perfect" -> "done. Perfect")
 * - Preserves English contractions without space (e.g. "I" + "'m" -> "I'm", "here" + "'s" -> "here's")
 * - Does not add unnecessary spaces for CJK characters (e.g. "你好" + "世界" -> "你好世界")
 */
export function smartJoinText(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;

  // If either boundary already has whitespace, simply concatenate
  if (/\s$/.test(prev) || /^\s/.test(next)) {
    return `${prev}${next}`;
  }

  const prevLastChar = prev.slice(-1);
  const nextFirstChar = next.slice(0, 1);

  const prevIsAlphaNum = /[A-Za-z0-9]/.test(prevLastChar);
  const nextIsAlphaNum = /[A-Za-z0-9]/.test(nextFirstChar);

  // Contractions: "I" + "'m" -> "I'm", "it" + "'s" -> "it's", "they" + "'re" -> "they're"
  if (prevIsAlphaNum && /^['’][a-zA-Z]/.test(next)) {
    return `${prev}${next}`;
  }

  // English alphanumeric to alphanumeric: "Start" + "Busy" -> "Start Busy", "restroom" + "right" -> "restroom right"
  if (prevIsAlphaNum && nextIsAlphaNum) {
    return `${prev} ${next}`;
  }

  // Punctuation to alphanumeric: "meeting," + "so" -> "meeting, so", "done." + "Perfect" -> "done. Perfect"
  const prevIsPunct = /[,.?!;:)]/.test(prevLastChar);
  if (prevIsPunct && nextIsAlphaNum) {
    return `${prev} ${next}`;
  }

  // Alphanumeric to open quote / bracket: e.g. 'said' + '"Well' -> 'said "Well'
  if (prevIsAlphaNum && /[(["']/.test(nextFirstChar)) {
    return `${prev} ${next}`;
  }

  return `${prev}${next}`;
}

const CAMEL_CASE_WHITELIST = new Set([
  'chatgpt', 'iphone', 'ipad', 'imac', 'macos', 'ios', 'github', 'gitlab',
  'youtube', 'netsuite', 'linkedin', 'paypal', 'devops', 'javascript',
  'typescript', 'hotwire', 'openai', 'sharepoint', 'peckhub', 'pekkahub',
  'provensoft', 'pelco', 'android', 'aws', 'api', 'apis',
]);

/**
 * Separates words that were glued together by streaming ASR output:
 * - Lowercase followed by Uppercase (e.g. "StartBusy" -> "Start Busy", "morningHere" -> "morning Here")
 * - Trailing lowercase before capitalized pronoun/contraction (e.g. "hereI've" -> "here I've")
 * - Missing space after punctuation (e.g. "chargeAt" -> "charge At", "done.Next" -> "done. Next")
 * Whitelists common legitimate camelCase tech terms (ChatGPT, iOS, iPad, etc.)
 */
export function separateGluedWords(text: string): string {
  if (!text || text.length < 3) return text;

  // 1. Separate lowercase letter followed by uppercase letter + lowercase letters: [a-z][A-Z][a-z]
  // e.g. "StartBusy" -> "Start Busy", "morningHere" -> "morning Here", "supervisorYeah" -> "supervisor Yeah"
  let res = text.replace(/([a-zA-Z]*[a-z])([A-Z][a-z]+)/g, (match, p1, p2) => {
    if (CAMEL_CASE_WHITELIST.has(match.toLowerCase())) {
      return match;
    }
    return `${p1} ${p2}`;
  });

  // 2. Separate lowercase letter followed by 'I' + contraction or single 'I'
  // e.g. "hereI've" -> "here I've", "thinkI" -> "think I"
  res = res.replace(/([a-z])(I(?:'[\w]+)?\b)/g, '$1 $2');

  // 3. Ensure space after punctuation if followed directly by an English letter
  res = res.replace(/([,.?!;:；：，。？！])([A-Za-z])/g, '$1 $2');

  return res;
}

/**
 * Suppresses repetitive hallucination loops in ASR output and normalizes punctuation spacing.
 * e.g. "no, no, no, no, no, no..." -> "no, no, no"
 */
export function suppressRepetitiveLoops(text: string, maxRepeats = 3): string {
  if (!text || text.length < 8) return separateGluedWords(text);

  let cleaned = separateGluedWords(text);

  // 1. Single word repetition (with optional commas/spaces/newlines):
  // Matches "no, no, no, no" or "no no no no" or ", no, no, no, no"
  cleaned = cleaned.replace(/(?:,\s*|\s+|^)(\b[\w']+\b)(?:[\s,、，。\r\n]+(?:\1)){3,}/gi, (match, word) => {
    const delimiter = match.includes(',') || match.includes('，') ? ', ' : ' ';
    const prefix = match.startsWith(',') ? ', ' : match.startsWith(' ') ? ' ' : '';
    return prefix + Array(maxRepeats).fill(word).join(delimiter);
  });

  // 2. Multi-word phrase repetition (phrase length 2 to 4 words):
  // e.g. "you know, you know, you know, you know" -> "you know, you know, you know"
  cleaned = cleaned.replace(/(?:,\s*|\s+|^)(\b(?:\w+\s+){1,3}\w+\b)(?:[\s,、，。\r\n]+(?:\1)){3,}/gi, (match, phrase) => {
    const delimiter = match.includes(',') || match.includes('，') ? ', ' : ' ';
    const prefix = match.startsWith(',') ? ', ' : match.startsWith(' ') ? ' ' : '';
    return prefix + Array(maxRepeats).fill(phrase).join(delimiter);
  });

  // 3. CJK character repetition: e.g. "对对对对对对对对" -> "对对对"
  cleaned = cleaned.replace(/([\u4e00-\u9fa5]{1,4})(?:[\s\r\n]*\1){3,}/g, (_match, char) => {
    return Array(maxRepeats).fill(char).join('');
  });

  // 4. Ensure space after English punctuation followed directly by an English letter
  // e.g. ",Louisville" -> ", Louisville", ".Okay" -> ". Okay", "meanI" is not punctuation so untouched
  cleaned = cleaned.replace(/([,.?!;:；：，。？！])([A-Za-z])/g, (_match, p1, p2) => `${p1} ${p2}`);

  // 5. Clean up duplicate commas
  cleaned = cleaned.replace(/([,，]\s*){2,}/g, ', ');

  return cleaned;
}

/**
 * Cleans segment text by suppressing repetition loops, ensuring punctuation spacing,
 * removing leading orphan punctuation, and trimming.
 */
export function cleanSegmentText(text: string): string {
  if (!text) return '';
  const suppressed = suppressRepetitiveLoops(text);
  return suppressed.replace(/^[.,;:，。；：\s]+/, '').trim();
}
