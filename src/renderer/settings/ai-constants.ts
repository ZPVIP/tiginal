
// This file will hold the shared constants and types for AI settings

export interface ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  apiKey?: string; // Decrypted for UI
  apiKeyEncrypted?: string;
  model: string;
  availableModels?: ModelConfig[]; // Updated to store config objects
  customHeaders?: Record<string, string>;
  autoCORSFix?: boolean;
  isDefault: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const OAI_API_PROVIDERS = [
  { label: "Custom", value: "custom", baseUrl: "" },
  { label: "Cerebras", value: "cerebras", baseUrl: "https://api.cerebras.ai/v1" },
  { label: "Ollama", value: "ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { label: "OpenAI", value: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "LLaMa.cpp", value: "llamacpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "LM Studio", value: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1" },
  { label: "Llamafile", value: "llamafile", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "DeepSeek", value: "deepseek", baseUrl: "https://api.deepseek.com" },
  { label: "Groq", value: "groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "Mistral", value: "mistral", baseUrl: "https://api.mistral.ai/v1" },
  { label: "Anthropic (Claude)", value: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { label: "OpenRouter", value: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "Google AI", value: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
];
