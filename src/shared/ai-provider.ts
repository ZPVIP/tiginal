export const API_FORMATS = [
  'chat-completions',
  'anthropic-messages',
  'responses',
] as const;

export type ApiFormat = typeof API_FORMATS[number];

export const CATALOG_NPM_PACKAGES = [
  '@ai-sdk/openai-compatible',
  '@ai-sdk/anthropic',
] as const;

export type CatalogNpmPackage = typeof CATALOG_NPM_PACKAGES[number];

export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export interface CatalogProvider {
  id: string;
  name: string;
  api: string;
  npm: CatalogNpmPackage;
}

export interface ModelCatalogUpdateResult {
  success: boolean;
  error?: string;
  modelCount?: number;
  providerCount?: number;
  updatedAt?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
  supportsPdf?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsReasoning?: boolean;
  supportsToolCalls?: boolean;
  supportsStructuredOutput?: boolean;
  reasoningEffortOptions?: ReasoningEffort[];
  catalogDetails?: string[];
}

export interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  catalogProvider?: string;
  apiKey?: string;
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: ModelConfig[];
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  apiFormat: ApiFormat;
  useMaxCompletionTokens: boolean;
  isDefault: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export function isApiFormat(value: unknown): value is ApiFormat {
  return typeof value === 'string' && API_FORMATS.some(format => format === value);
}

export function normalizeApiFormat(value: unknown): ApiFormat {
  return isApiFormat(value) ? value : 'chat-completions';
}

export function isCatalogNpmPackage(value: unknown): value is CatalogNpmPackage {
  return typeof value === 'string' && CATALOG_NPM_PACKAGES.some(packageName => packageName === value);
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.some(effort => effort === value);
}

export function defaultReasoningEffort(
  options: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
  if (options.includes('medium')) return 'medium';
  return options[0];
}

export function apiFormatForCatalogPackage(packageName: CatalogNpmPackage): ApiFormat {
  return packageName === '@ai-sdk/anthropic' ? 'anthropic-messages' : 'chat-completions';
}
