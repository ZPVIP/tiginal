import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChunkTimelineEntry } from './ChunkTimelineWriter';
import {
  cleanSegmentText,
  smartJoinText,
  suppressRepetitiveLoops,
} from '../../shared/audio/textUtils';

export interface SpeakerTurn {
  speaker: number;
  start: number;
  end: number;
  start_ms: number;
  end_ms: number;
}

export interface DiarizedSegment {
  speakerId: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
}

export function formatSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export interface AlignedSegment {
  speaker: number;
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface DiscoveredModel {
  path: string;
  name: string;
  sizeBytes: number;
  kind: 'nemotron' | 'mms-align' | 'whisper';
  isRecommended: boolean;
  label: string;
}

export interface DiscoveredDiarizeModels {
  nemotron: DiscoveredModel[];
  mmsAlign: DiscoveredModel[];
  whisper: DiscoveredModel[];
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function scanFilesRecursively(dir: string, maxDepth = 3, currentDepth = 0): string[] {
  if (!fs.existsSync(dir) || currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanFilesRecursively(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore directory scan errors
  }
  return results;
}

function getSavedSetting(key: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDatabase } = require('../../services/database/database');
    return getDatabase().getSetting(key);
  } catch {
    return null;
  }
}

export function scanDiscoveredDiarizeModels(customRoot?: string): DiscoveredDiarizeModels {
  const rootDirs = [
    path.join(os.homedir(), '.cache', 'tiginal', 'models'),
  ];
  const settingDir = getSavedSetting('tiginal_diarize_custom_dir');
  if (settingDir && fs.existsSync(settingDir) && !rootDirs.includes(settingDir)) {
    rootDirs.unshift(settingDir);
  }
  if (customRoot && fs.existsSync(customRoot) && !rootDirs.includes(customRoot)) {
    rootDirs.unshift(customRoot);
  }

  const allFiles = new Set<string>();
  for (const root of rootDirs) {
    for (const file of scanFilesRecursively(root, 3)) {
      allFiles.add(file);
    }
  }

  const nemotron: DiscoveredModel[] = [];
  const mmsAlign: DiscoveredModel[] = [];
  const whisper: DiscoveredModel[] = [];

  for (const filePath of allFiles) {
    const fileName = path.basename(filePath);
    const lowerPath = filePath.toLowerCase();
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(filePath).size;
    } catch {
      continue;
    }

    // 1. Nemotron models
    if (fileName.endsWith('.onnx') && (lowerPath.includes('nemotron') || lowerPath.includes('diarization'))) {
      const isQuantized = fileName.includes('quantized');
      nemotron.push({
        path: filePath,
        name: fileName,
        sizeBytes,
        kind: 'nemotron',
        isRecommended: isQuantized,
        label: `${fileName} (${formatFileSize(sizeBytes)})${isQuantized ? ' - Recommended' : ''}`,
      });
    }

    // 2. MMS-Align models
    if (fileName.endsWith('.onnx') && (lowerPath.includes('mms') || lowerPath.includes('wav2vec2') || lowerPath.includes('align'))) {
      let score = 50;
      let note = '';
      if (fileName === 'model_q4.onnx') {
        score = 100;
        note = ' - Recommended (Fast & Accurate)';
      } else if (fileName === 'model_q4f16.onnx') {
        score = 95;
        note = ' - Quantized';
      } else if (fileName === 'model_fp16.onnx') {
        score = 90;
        note = ' - Half Precision';
      } else if (fileName === 'model.onnx') {
        score = 80;
        note = ' - Full Precision';
      }
      mmsAlign.push({
        path: filePath,
        name: fileName,
        sizeBytes,
        kind: 'mms-align',
        isRecommended: score === 100,
        label: `${fileName} (${formatFileSize(sizeBytes)})${note}`,
      });
    }

    // 3. Whisper models
    if (fileName.endsWith('.bin') && !fileName.endsWith('.mlmodelc.zip')) {
      let score = 40;
      let note = '';
      if (fileName === 'ggml-large-v3-turbo.bin') {
        score = 100;
        note = ' - Recommended (Best Accuracy & Turbo Speed)';
      } else if (fileName.includes('large-v3-turbo-q5_0')) {
        score = 95;
        note = ' - Quantized Turbo';
      } else if (fileName.includes('large-v3-turbo-q8_0')) {
        score = 90;
        note = ' - Quantized Turbo';
      } else if (fileName === 'ggml-large-v3.bin') {
        score = 85;
        note = ' - Large v3';
      } else if (fileName === 'ggml-medium.bin') {
        score = 75;
      } else if (fileName === 'ggml-small.bin') {
        score = 70;
        note = ' - Lightweight';
      } else if (fileName === 'ggml-base.bin') {
        score = 60;
      } else if (fileName === 'ggml-tiny.bin') {
        score = 50;
      }
      whisper.push({
        path: filePath,
        name: fileName,
        sizeBytes,
        kind: 'whisper',
        isRecommended: score === 100,
        label: `${fileName} (${formatFileSize(sizeBytes)})${note}`,
      });
    }
  }

  // Sort by priority (recommended first, then name/size)
  const sortModels = (items: DiscoveredModel[]) => {
    return items.sort((a, b) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      return a.name.localeCompare(b.name);
    });
  };

  return {
    nemotron: sortModels(nemotron),
    mmsAlign: sortModels(mmsAlign),
    whisper: sortModels(whisper),
  };
}

export function defaultDiarizeModelPath(): string {
  const custom = getSavedSetting('tiginal_diarize_nemotron_model');
  if (custom && fs.existsSync(custom)) {
    return custom;
  }
  const discovered = scanDiscoveredDiarizeModels().nemotron;
  if (discovered.length > 0) {
    return discovered[0].path;
  }
  return path.join(os.homedir(), '.cache', 'tiginal', 'models', 'nemotron-3-diarization', 'model_quantized.onnx');
}

export function defaultAlignModelPath(): string | undefined {
  const custom = getSavedSetting('tiginal_diarize_align_model');
  if (custom && fs.existsSync(custom)) {
    return custom;
  }
  const discovered = scanDiscoveredDiarizeModels().mmsAlign;
  if (discovered.length > 0) {
    return discovered[0].path;
  }
  return undefined;
}

export function defaultWhisperModelPath(): string | undefined {
  const custom = getSavedSetting('tiginal_diarize_whisper_model');
  if (custom && fs.existsSync(custom)) {
    return custom;
  }
  const discovered = scanDiscoveredDiarizeModels().whisper;
  if (discovered.length > 0) {
    return discovered[0].path;
  }
  return undefined;
}

export interface TiginalDiarizeOptions {
  modelPath?: string;
  transcriptPath?: string;
  transcribe?: boolean;
  whisperModelPath?: string;
  alignModelPath?: string;
  language?: string;
  writeArtifacts?: boolean;
}

export interface FullDiarizationResult {
  turns: SpeakerTurn[];
  transcript?: string;
  segments?: AlignedSegment[];
  diar_text?: string;
  srt?: string;
}

/**
 * Runs `tiginal-diarize <audioPath>` via subprocess and parses the JSON output.
 */
export async function runTiginalDiarize(
  audioPath: string,
  modelPathOrOptions?: string | TiginalDiarizeOptions,
): Promise<SpeakerTurn[]> {
  const options = typeof modelPathOrOptions === 'string'
    ? { modelPath: modelPathOrOptions }
    : modelPathOrOptions;
  const result = await runTiginalDiarizePipeline(audioPath, options);
  return result.turns;
}

export async function runTiginalDiarizePipeline(
  audioPath: string,
  options: TiginalDiarizeOptions = {},
): Promise<FullDiarizationResult> {
  return new Promise((resolve, reject) => {
    const customModel = options.modelPath || defaultDiarizeModelPath();
    const args = [audioPath];
    if (fs.existsSync(customModel)) {
      args.push('-m', customModel);
    }
    if (options.transcriptPath && fs.existsSync(options.transcriptPath)) {
      args.push('-t', options.transcriptPath);
    }
    const alignModel = options.alignModelPath || defaultAlignModelPath();
    if (alignModel && fs.existsSync(alignModel)) {
      args.push('--align-model', alignModel);
    }
    if (options.transcribe) {
      args.push('--transcribe');
      const whisperModel = options.whisperModelPath || defaultWhisperModelPath();
      if (whisperModel && fs.existsSync(whisperModel)) {
        args.push('--whisper-model', whisperModel);
      }
    }
    if (options.language) {
      args.push('-l', options.language);
    }
    if (options.writeArtifacts) {
      args.push('--write-artifacts');
    }

    // Try system PATH first
    const proc = child_process.spawn('tiginal-diarize', args, {
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin:${os.homedir()}/.cargo/bin`,
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    proc.on('error', err => {
      reject(new Error(`Failed to spawn tiginal-diarize: ${err.message}`));
    });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`tiginal-diarize exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const rawJson = stdout.trim();
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          resolve({ turns: parsed as SpeakerTurn[] });
        } else if (parsed && typeof parsed === 'object') {
          resolve({
            turns: parsed.turns || [],
            transcript: parsed.transcript,
            segments: parsed.segments,
            diar_text: parsed.diar_text,
            srt: parsed.srt,
          });
        } else {
          resolve({ turns: [] });
        }
      } catch (err) {
        reject(new Error(`Failed to parse tiginal-diarize JSON output: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

const INCOMPLETE_TRAILING_WORDS = new Set([
  'and', 'or', 'but', 'so', 'because', 'to', 'the', 'a', 'an', 'that', 'this', 'for', 'of', 'in', 'on', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'there',
]);

interface CandidateSentence {
  text: string;
  charStart: number;
  charEnd: number;
  rawStartMs: number;
  rawEndMs: number;
  smoothStartMs: number;
  smoothEndMs: number;
}

/**
 * Aligns chunk timeline entries with speaker turns.
 * Guarantees syntactic sentence integrity (never breaks mid-clause)
 * and uses smooth monotonic interpolation to align chunk batches with Nemotron turns.
 */
export function alignChunksWithSpeakers(
  entries: readonly ChunkTimelineEntry[],
  turns: readonly SpeakerTurn[],
  _chunkSizeMs = 160,
  _lookaheadLatencyMs = 300,
): DiarizedSegment[] {
  if (entries.length === 0) return [];
  if (turns.length === 0) {
    let fullText = '';
    for (const e of entries) {
      fullText = smartJoinText(fullText, e.text);
    }
    fullText = cleanSegmentText(fullText);
    const startMs = entries[0].timestampMs;
    const endMs = entries[entries.length - 1].timestampMs;
    return [{
      speakerId: 0,
      speakerLabel: 'Speaker 1',
      startMs,
      endMs,
      text: fullText,
    }];
  }

  // 1. Build continuous text and character-to-chunk arrival timestamp mapping
  let fullText = '';
  const charArrivalTimes: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.text) continue;

    const prevEntry = i > 0 ? entries[i - 1] : null;
    // If a large silence gap occurs (> 3500ms) and the previous text was not an incomplete connector,
    // ensure an utterance boundary (period) separates the phrases
    if (prevEntry && (entry.timestampMs - prevEntry.timestampMs) > 3500 && fullText.length > 0) {
      const trimmed = fullText.trim();
      const lastWord = trimmed.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z']/g, '') || '';
      const endsWithPunct = /[.?!。？！\n]$/.test(trimmed);
      const nextStartsCap = /^[A-Z]/.test(entry.text.trim());

      if (!endsWithPunct && nextStartsCap && !INCOMPLETE_TRAILING_WORDS.has(lastWord)) {
        fullText += '. ';
        charArrivalTimes.push(prevEntry.timestampMs, prevEntry.timestampMs);
      }
    }

    const beforeLen = fullText.length;
    fullText = smartJoinText(fullText, entry.text);
    const afterLen = fullText.length;
    for (let k = beforeLen; k < afterLen; k++) {
      charArrivalTimes.push(entry.timestampMs);
    }
  }

  fullText = suppressRepetitiveLoops(fullText);

  // 2. Extract full syntactic sentences (never breaking mid-clause or on commas)
  const sentenceRegex = /([^.?!。？！\n]+[.?!。？！]+|[^.?!。？！\n]+$)/g;
  let match: RegExpExecArray | null;
  const candidates: CandidateSentence[] = [];

  while ((match = sentenceRegex.exec(fullText)) !== null) {
    const raw = match[0];
    const charStart = match.index;
    const charEnd = match.index + raw.length;
    const cleaned = cleanSegmentText(raw);
    if (!cleaned) continue;

    const rawStartMs = charArrivalTimes[charStart] ?? (entries[0]?.timestampMs ?? 0);
    const rawEndMs = charArrivalTimes[Math.min(charArrivalTimes.length - 1, charEnd - 1)] ?? rawStartMs;

    candidates.push({
      text: cleaned,
      charStart,
      charEnd,
      rawStartMs,
      rawEndMs: Math.max(rawEndMs, rawStartMs + 100),
      smoothStartMs: 0,
      smoothEndMs: 0,
    });
  }

  if (candidates.length === 0) return [];

  // 3. Smooth timestamps across WebSocket chunk arrival batches
  let prevAnchorMs = 0;
  for (let i = 0; i < candidates.length; ) {
    let j = i;
    while (j < candidates.length && candidates[j].rawEndMs === candidates[i].rawEndMs) {
      j++;
    }
    const batchArrivalMs = candidates[i].rawEndMs;
    const batchCount = j - i;

    let totalChars = 0;
    for (let k = i; k < j; k++) totalChars += candidates[k].text.length;

    const spanMs = Math.max(batchCount * 800, batchArrivalMs - prevAnchorMs);
    const spanStartMs = Math.max(0, batchArrivalMs - spanMs);

    let currentMs = spanStartMs;
    for (let k = i; k < j; k++) {
      const fraction = totalChars > 0 ? (candidates[k].text.length / totalChars) : (1 / batchCount);
      const dur = Math.max(600, Math.round(spanMs * fraction));
      candidates[k].smoothStartMs = currentMs;
      candidates[k].smoothEndMs = currentMs + dur;
      currentMs += dur;
    }

    prevAnchorMs = batchArrivalMs;
    i = j;
  }

  // 4. Assign each complete sentence to the best overlapping Nemotron turn
  const assigned = candidates.map(sentence => {
    const sStart = sentence.smoothStartMs;
    const sEnd = sentence.smoothEndMs;

    let bestSpeaker = turns[0]?.speaker ?? 0;
    let maxOverlap = 0;
    let minDistance = Infinity;
    let closestSpeaker = bestSpeaker;

    for (const turn of turns) {
      const overlapStart = Math.max(sStart, turn.start_ms);
      const overlapEnd = Math.min(sEnd, turn.end_ms);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestSpeaker = turn.speaker;
      }
      const turnMid = (turn.start_ms + turn.end_ms) / 2;
      const sMid = (sStart + sEnd) / 2;
      const dist = Math.abs(turnMid - sMid);
      if (dist < minDistance) {
        minDistance = dist;
        closestSpeaker = turn.speaker;
      }
    }

    const finalSpeaker = maxOverlap > 0 ? bestSpeaker : closestSpeaker;
    return {
      speakerId: finalSpeaker,
      speakerLabel: `Speaker ${finalSpeaker + 1}`,
      startMs: sStart,
      endMs: sEnd,
      text: sentence.text,
    };
  });

  // 5. Merge consecutive sentences from the same speaker if silence gap <= 2000ms
  const merged: DiarizedSegment[] = [];
  for (const seg of assigned) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    const gap = prev ? seg.startMs - prev.endMs : 0;
    if (prev && prev.speakerId === seg.speakerId && gap <= 2000) {
      prev.endMs = Math.max(prev.endMs, seg.endMs);
      prev.text = smartJoinText(prev.text, seg.text);
    } else {
      merged.push({ ...seg });
    }
  }

  for (const seg of merged) {
    seg.text = cleanSegmentText(seg.text);
  }

  return merged.filter(seg => seg.text.length > 0);
}

/**
 * Builds standard `-diar.txt` text content.
 * e.g.
 * Speaker 1: 今天我去上班了。
 * Speaker 2: 好的，路上注意安全。
 */
export function buildDiarizedText(segments: readonly DiarizedSegment[]): string {
  if (segments.length === 0) return '';
  return segments
    .map(seg => `${seg.speakerLabel}: ${cleanSegmentText(seg.text)}`)
    .filter(line => line.length > 0)
    .join('\n') + '\n';
}

/**
 * Builds standard `.srt` subtitle format.
 * Automatically splits multi-sentence paragraphs into individual subtitle blocks
 * so subtitles are easily readable without overflowing or creating horizontal scrollbars.
 */
export function buildSrtContent(segments: readonly DiarizedSegment[]): string {
  if (segments.length === 0) return '';
  const blocks: string[] = [];

  for (const seg of segments) {
    const text = cleanSegmentText(seg.text);
    if (!text) continue;

    // Split segment into sentences for readable subtitle cards
    const sentenceRegex = /([^.?!。？！\n]+[.?!。？！]+|[^.?!。？！\n]+$)/g;
    const subSentences: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = sentenceRegex.exec(text)) !== null) {
      const s = cleanSegmentText(match[0]);
      if (s) subSentences.push(s);
    }
    if (subSentences.length === 0) subSentences.push(text);

    const totalChars = subSentences.reduce((acc, s) => acc + s.length, 0);
    const totalDuration = Math.max(1000, seg.endMs - seg.startMs);
    let curStart = seg.startMs;

    for (const sub of subSentences) {
      const frac = totalChars > 0 ? sub.length / totalChars : 1 / subSentences.length;
      const subDur = Math.max(800, Math.round(totalDuration * frac));
      const subEnd = Math.min(seg.endMs, curStart + subDur);

      const index = blocks.length + 1;
      const timeRange = `${formatSrtTime(curStart)} --> ${formatSrtTime(subEnd)}`;
      const line = `[${seg.speakerLabel}] ${sub}`;
      blocks.push(`${index}\n${timeRange}\n${line}\n`);

      curStart = subEnd;
    }
  }

  return blocks.join('\n');
}

/**
 * Reconstructs synthetic chunk timeline entries from a transcript and audio duration.
 * Used for retry diarization when original -chunk.txt was missing.
 */
export function ensureChunkEntriesFromTranscript(
  transcript: string,
  totalDurationMs: number,
  chunkSizeMs = 160,
): ChunkTimelineEntry[] {
  const clean = cleanSegmentText(transcript);
  if (!clean) return [];

  // Split into sentences using punctuation while preserving punctuation attached to each sentence
  const rawSentences = clean.split(/([。？！，；?!;,]+)/).filter(Boolean);
  const parts: string[] = [];
  for (let i = 0; i < rawSentences.length; i += 2) {
    const text = (rawSentences[i] || '') + (rawSentences[i + 1] || '');
    const cleanedPart = cleanSegmentText(text);
    if (cleanedPart) parts.push(cleanedPart);
  }
  if (parts.length === 0) parts.push(clean);

  const durationPerPart = Math.max(chunkSizeMs, Math.round(totalDurationMs / parts.length));
  const entries: ChunkTimelineEntry[] = [];
  let currentMs = 0;
  for (const part of parts) {
    currentMs += durationPerPart;
    entries.push({
      timestampMs: Math.min(totalDurationMs, currentMs),
      text: part,
    });
  }
  return entries;
}
