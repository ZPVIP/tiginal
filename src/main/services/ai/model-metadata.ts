import type { ModelConfig, ReasoningEffort } from '../../../shared/ai-provider';
import { isReasoningEffort } from '../../../shared/ai-provider';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : undefined;
}

function firstPositiveInteger(value: unknown, paths: readonly (readonly string[])[]): number | undefined {
  for (const path of paths) {
    const result = positiveInteger(readPath(value, path));
    if (result !== undefined) return result;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function reasoningEffortOptions(value: Record<string, unknown>): ReasoningEffort[] {
  const candidates: unknown[] = [
    ...stringArray(value.reasoningEffortOptions),
    ...stringArray(value.supportedReasoningEfforts),
    ...stringArray(value.supported_reasoning_efforts),
    ...stringArray(readPath(value, ['capabilities', 'supports', 'reasoning_effort'])),
  ];
  if (Array.isArray(value.reasoning_options)) {
    for (const option of value.reasoning_options) {
      if (isRecord(option) && option.type === 'effort') {
        candidates.push(...stringArray(option.values));
      }
    }
  }
  return [...new Set(candidates.filter(isReasoningEffort))];
}

function includesImage(value: unknown): boolean {
  return stringArray(value).some(item => /image|vision/i.test(item));
}

function includesReasoning(value: unknown): boolean {
  return stringArray(value).some(item => /reasoning|thinking/i.test(item));
}

function includesCapability(value: unknown, pattern: RegExp): boolean {
  return stringArray(value).some(item => pattern.test(item));
}

function trueAt(value: unknown, paths: readonly (readonly string[])[]): boolean {
  return paths.some(path => readPath(value, path) === true);
}

const CONTEXT_PATHS = [
  ['contextWindow'],
  ['context_length'],
  ['max_model_len'],
  ['max_context_length'],
  ['context_window'],
  ['n_ctx'],
  ['inputTokenLimit'],
  ['limit', 'context'],
  ['top_provider', 'context_length'],
  ['capabilities', 'limits', 'max_context_window_tokens'],
] as const;

const OUTPUT_PATHS = [
  ['maxOutputTokens'],
  ['max_output_tokens'],
  ['output_token_limit'],
  ['max_completion_tokens'],
  ['limit', 'output'],
  ['top_provider', 'max_completion_tokens'],
  ['capabilities', 'limits', 'max_output_tokens'],
] as const;

function parseModel(value: unknown): ModelConfig | null {
  if (!isRecord(value)) return null;

  const rawId = typeof value.id === 'string'
    ? value.id
    : typeof value.name === 'string'
      ? value.name
      : typeof value.model === 'string'
        ? value.model
        : null;
  if (!rawId) return null;

  const name = typeof value.display_name === 'string'
    ? value.display_name
    : typeof value.name === 'string'
      ? value.name
      : rawId;

  const supportsImages = trueAt(value, [
    ['supportsImages'],
    ['supports_vision'],
    ['supports_images'],
    ['supports_image_input'],
    ['capabilities', 'supports', 'vision'],
    ['capabilities', 'supports', 'image_input'],
  ]) || includesImage(value.input_modalities)
    || includesImage(value.modalities)
    || includesImage(readPath(value, ['modalities', 'input']))
    || includesImage(readPath(value, ['architecture', 'input_modalities']));

  const supportsReasoning = trueAt(value, [
    ['supportsReasoning'],
    ['reasoning'],
    ['supports_reasoning'],
    ['supports_thinking'],
    ['capabilities', 'supports', 'reasoning'],
    ['capabilities', 'supports', 'extended_thinking'],
  ]) || reasoningEffortOptions(value).length > 0
    || includesReasoning(value.supported_parameters)
    || includesReasoning(readPath(value, ['capabilities', 'supported_parameters']));

  const inputModalities = [
    ...stringArray(value.input_modalities),
    ...stringArray(value.modalities),
    ...stringArray(readPath(value, ['modalities', 'input'])),
    ...stringArray(readPath(value, ['architecture', 'input_modalities'])),
  ];
  const supportedParameters = [
    ...stringArray(value.supported_parameters),
    ...stringArray(readPath(value, ['capabilities', 'supported_parameters'])),
  ];
  const supportsPdf = trueAt(value, [
    ['supportsPdf'],
    ['supports_pdf'],
    ['supports_document_input'],
    ['capabilities', 'supports', 'pdf'],
  ]) || includesCapability(inputModalities, /pdf|document/i);
  const supportsAudio = trueAt(value, [
    ['supportsAudio'],
    ['supports_audio'],
    ['capabilities', 'supports', 'audio'],
  ]) || includesCapability(inputModalities, /audio/i);
  const supportsVideo = trueAt(value, [
    ['supportsVideo'],
    ['supports_video'],
    ['capabilities', 'supports', 'video'],
  ]) || includesCapability(inputModalities, /video/i);
  const supportsToolCalls = trueAt(value, [
    ['supportsToolCalls'],
    ['supports_tools'],
    ['supports_tool_calls'],
    ['tool_call'],
    ['capabilities', 'supports', 'tools'],
  ]) || includesCapability(supportedParameters, /tool|function.call/i);
  const supportsStructuredOutput = trueAt(value, [
    ['supportsStructuredOutput'],
    ['supports_structured_output'],
    ['supports_json_schema'],
    ['structured_output'],
    ['capabilities', 'supports', 'structured_output'],
  ]) || includesCapability(supportedParameters, /response.format|json.schema|structured/i);

  const model: ModelConfig = {
    id: rawId,
    name,
    enabled: value.enabled !== false,
  };
  const contextWindow = firstPositiveInteger(value, CONTEXT_PATHS);
  const maxOutputTokens = firstPositiveInteger(value, OUTPUT_PATHS);
  const effortOptions = reasoningEffortOptions(value);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens;
  if (supportsImages) model.supportsImages = true;
  if (supportsPdf) model.supportsPdf = true;
  if (supportsAudio) model.supportsAudio = true;
  if (supportsVideo) model.supportsVideo = true;
  if (supportsReasoning) model.supportsReasoning = true;
  if (supportsToolCalls) model.supportsToolCalls = true;
  if (supportsStructuredOutput) model.supportsStructuredOutput = true;
  if (effortOptions.length > 0) model.reasoningEffortOptions = effortOptions;
  const catalogDetails = stringArray(value.catalogDetails);
  if (catalogDetails.length > 0) model.catalogDetails = catalogDetails;
  return model;
}

export function parseModelListPayload(payload: unknown): ModelConfig[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];

  const models = new Map<string, ModelConfig>();
  for (const candidate of candidates) {
    const model = typeof candidate === 'string'
      ? { id: candidate, name: candidate, enabled: true }
      : parseModel(candidate);
    if (model && !models.has(model.id)) models.set(model.id, model);
  }
  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parseStoredModels(value: string | null): ModelConfig[] | undefined {
  if (!value) return undefined;
  try {
    const models = parseModelListPayload(JSON.parse(value));
    return models.length > 0 ? models : [];
  } catch {
    return undefined;
  }
}

export function resolveReasoningEffort(
  models: readonly ModelConfig[] | undefined,
  modelId: string,
  requestedEffort: unknown,
): ReasoningEffort | undefined {
  if (!isReasoningEffort(requestedEffort)) return undefined;
  const model = models?.find(candidate => candidate.id === modelId);
  return model?.reasoningEffortOptions?.includes(requestedEffort)
    ? requestedEffort
    : undefined;
}
