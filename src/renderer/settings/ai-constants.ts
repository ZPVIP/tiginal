
export type {
  AIProvider,
  ApiFormat,
  CatalogNpmPackage,
  CatalogProvider,
  ModelCatalogUpdateResult,
  ModelConfig,
  ReasoningEffort,
} from '../../shared/ai-provider';
export {
  apiFormatForCatalogPackage,
  defaultReasoningEffort,
  isApiFormat,
  isReasoningEffort,
} from '../../shared/ai-provider';

export const API_FORMAT_OPTIONS = [
  { label: 'Chat Completions (/chat/completions)', value: 'chat-completions' },
  { label: 'Anthropic Messages (/v1/messages)', value: 'anthropic-messages' },
] as const;

export function providerIconKey(provider: string | undefined): string {
  if (!provider) return 'custom';
  const aliases: Readonly<Record<string, string>> = {
    google: 'gemini',
    'ollama-cloud': 'ollama',
    'ollama-local': 'ollama',
    nvidia: 'nvidia_nim',
  };
  return aliases[provider] ?? provider;
}

export const OAI_API_PROVIDERS = [
  { label: "Custom", value: "custom", baseUrl: "" },
  { label: "Google AI", value: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Llamafile", value: "llamafile", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "LLaMa.cpp", value: "llamacpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "LM Studio", value: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1" },
  { label: "Ollama (Local)", value: "ollama-local", baseUrl: "http://127.0.0.1:11434/v1" },
];
