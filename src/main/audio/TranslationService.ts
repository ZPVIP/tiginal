import type Database from 'better-sqlite3';
import type { CryptoService } from '../../services/ssh/CryptoService';
import type {
  AudioSessionTranslationConfig,
  TranslationEngineCandidate,
  TranslationRequest,
  TranslationResult,
  TranslationSessionEvent,
} from '../../shared/audio/types';
import { SpeechProviderStore } from './SpeechProviderStore';
import {
  defaultT3POInstructions,
  T3POStreamingTranslator,
} from './T3POStreamingTranslator';
import { fetchOpenAIWithCompatibility } from '../services/ai/openai-request';
import { callNonStreamingChatCompletion } from '../chat-handlers';

export function toLanguageName(lang: string): string {
  const norm = (lang || '').trim().toLowerCase();
  const map: Record<string, string> = {
    zh: 'Chinese',
    'zh-cn': 'Chinese',
    'zh-hans': 'Chinese',
    'zh-tw': 'Chinese',
    'zh-hant': 'Chinese',
    cn: 'Chinese',
    chinese: 'Chinese',
    en: 'English',
    'en-us': 'English',
    'en-gb': 'English',
    english: 'English',
    ja: 'Japanese',
    japanese: 'Japanese',
    ko: 'Korean',
    korean: 'Korean',
    fr: 'French',
    french: 'French',
    de: 'German',
    german: 'German',
    es: 'Spanish',
    spanish: 'Spanish',
    ru: 'Russian',
    russian: 'Russian',
    it: 'Italian',
    italian: 'Italian',
    pt: 'Portuguese',
    portuguese: 'Portuguese',
    auto: 'Chinese',
  };
  return map[norm] || (norm ? norm.charAt(0).toUpperCase() + norm.slice(1) : 'English');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class TranslationService {
  constructor(
    private readonly db: Database.Database,
    private readonly cryptoService: CryptoService,
    private readonly speechStore: SpeechProviderStore,
    private readonly getLocalSupervisor?: () => { list(): Array<{ id: string; displayName: string; endpoint: string | null; status: string; engineId: string }> },
  ) {}

  public listCandidates(): TranslationEngineCandidate[] {
    const candidates: TranslationEngineCandidate[] = [];

    // 1. Speech providers supporting T3PO
    try {
      const speechRows: unknown[] = this.db.prepare(`
        SELECT id, name, protocol, endpoint, default_language, enabled FROM speech_providers
        WHERE enabled = 1
        ORDER BY name COLLATE NOCASE
      `).all();

      for (const row of speechRows) {
        if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') continue;
        const protocol = typeof row.protocol === 'string' ? row.protocol : '';
        const endpoint = typeof row.endpoint === 'string' ? row.endpoint : '';
        const isT3PO = protocol.startsWith('t3po');
        if (!isT3PO) continue;
        const isWs = endpoint.startsWith('ws://') || endpoint.startsWith('wss://');
        candidates.push({
          id: `speech-provider:${row.id}`,
          label: row.name,
          description: `${protocol} · ${isWs ? 'WebSocket Streaming' : 'Speech Translation'}`,
          source: 'speech-provider',
          capabilities: isWs ? ['translation', 'simultaneous-translation'] : ['translation'],
          isSimultaneous: isWs,
          endpoint,
          protocol,
          defaultLanguage: typeof row.default_language === 'string' ? row.default_language : 'zh',
        });
      }
    } catch {
      // Table may not exist yet in certain test contexts
    }

    // 2. Remote AI providers (OpenAI, Claude, DeepSeek, etc.)
    try {
      const aiRows: unknown[] = this.db.prepare(`
        SELECT id, name, model, endpoint FROM ai_providers ORDER BY name COLLATE NOCASE
      `).all();

      for (const row of aiRows) {
        if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') continue;
        const model = typeof row.model === 'string' ? row.model : '';
        const endpoint = typeof row.endpoint === 'string' ? row.endpoint : 'https://api.openai.com/v1';
        const isWs = endpoint.startsWith('ws://') || endpoint.startsWith('wss://');
        candidates.push({
          id: `remote-ai:${row.id}:${model}`,
          label: model ? `${row.name} / ${model}` : row.name,
          description: 'Remote Language Model',
          source: 'remote',
          capabilities: isWs ? ['translation', 'simultaneous-translation', 'text-generation'] : ['translation', 'text-generation'],
          isSimultaneous: isWs,
          endpoint,
          protocol: isWs ? 'ws' : 'http',
        });
      }
    } catch {
      // Ignore
    }

    // 3. Local model instances
    if (this.getLocalSupervisor) {
      try {
        const instances = this.getLocalSupervisor().list();
        for (const inst of instances) {
          if (inst.status !== 'running') continue;
          const isT3PO = inst.displayName.toLowerCase().includes('t3po');
          const endpoint = inst.endpoint || '';
          const isWs = endpoint.startsWith('ws://') || endpoint.startsWith('wss://');
          candidates.push({
            id: `local-model:${inst.id}`,
            label: inst.displayName,
            description: `${inst.engineId} · Local Model`,
            source: 'local',
            capabilities: isWs ? ['translation', 'simultaneous-translation'] : ['translation', 'text-generation'],
            isSimultaneous: isWs,
            endpoint,
            protocol: isWs ? 'ws' : 'http',
          });
        }
      } catch {
        // Ignore
      }
    }

    return candidates;
  }

  public async translateStatic(request: TranslationRequest): Promise<TranslationResult> {
    const startedAt = Date.now();
    const { engineId, text, sourceLanguage, targetLanguage } = request;
    if (!text.trim()) {
      return { translatedText: '', engineId, durationMs: 0 };
    }

    if (engineId.startsWith('speech-provider:')) {
      const providerId = engineId.slice('speech-provider:'.length);
      const resolved = this.speechStore.require(providerId);

      const protocol = resolved.provider.protocol || '';
      if (!protocol.startsWith('t3po')) {
        throw new Error(
          `Speech provider "${resolved.provider.name}" uses speech recognition protocol "${protocol}", which does not support text translation. Please select an LLM or T3PO translation engine.`
        );
      }

      const endpoint = resolved.provider.endpoint;
      const apiKey = resolved.credential ?? undefined;
      const model = ((resolved.provider.options as unknown as Record<string, unknown>)?.model as string) || 'Confucius4-T3PO';

      // Run T3PO translator in forced mode
      const translator = new T3POStreamingTranslator({
        endpoint,
        apiKey,
        model,
        sourceLanguage,
        targetLanguage,
        latencyMode: request.latencyMode,
        instructions: request.instructions,
        terminology: request.terminology,
      });

      translator.pushCommittedText(text);
      const translated = await translator.flush();
      return {
        translatedText: translated,
        engineId,
        durationMs: Date.now() - startedAt,
      };
    }

    if (engineId.startsWith('remote-ai:')) {
      const parts = engineId.slice('remote-ai:'.length).split(':');
      const providerId = parts[0];
      const model = parts.slice(1).join(':');

      const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`AI provider not found (id: ${providerId})`);

      let apiKey: string | null = null;
      if (typeof row.api_key_encrypted === 'string' && row.api_key_encrypted) {
        if (!this.cryptoService.isUnlocked()) {
          throw new Error('Key storage is locked. Please unlock in Settings.');
        }
        try {
          apiKey = this.cryptoService.decrypt(row.api_key_encrypted);
        } catch {
          throw new Error('Failed to decrypt API key');
        }
      }

      let customHeaders: Record<string, string> = {};
      if (typeof row.custom_headers === 'string' && row.custom_headers) {
        try {
          const parsed = JSON.parse(row.custom_headers);
          if (parsed && typeof parsed === 'object') {
            customHeaders = parsed;
          }
        } catch {}
      }

      const apiFormat = row.type === 'copilot'
        ? 'chat-completions'
        : (typeof row.api_format === 'string' ? row.api_format : 'chat-completions') as any;

      const sourceLangName = toLanguageName(sourceLanguage);
      const targetLangName = toLanguageName(targetLanguage);
      const systemInstruction = `You are a professional translator. Translate the given text from ${sourceLangName.toLowerCase()} to ${targetLangName.toLowerCase()}. Output ONLY the translated text without explanations, greetings, or notes.`;
      const instructions = request.instructions ? `\nInstructions: ${request.instructions}` : '';

      let terms = '';
      if (Array.isArray(request.terminology) && request.terminology.length > 0) {
        terms = `\nTerminology Constraints:\n${request.terminology.join('\n')}`;
      }

      const modelToUse = model || (typeof row.model === 'string' ? row.model : 'gpt-4o');

      const result = await callNonStreamingChatCompletion(
        {
          type: (row.type === 'copilot' ? 'copilot' : 'openai-compatible'),
          endpoint: typeof row.endpoint === 'string' && row.endpoint.trim() ? row.endpoint.trim() : 'https://api.openai.com/v1',
          apiKey,
          model: modelToUse,
          customHeaders,
          apiFormat,
          useMaxCompletionTokens: row.use_max_completion_tokens === 1,
        },
        [
          { role: 'system', content: `${systemInstruction}${instructions}${terms}` },
          { role: 'user', content: text },
        ],
        {
          temperature: 0.1,
          maxTokens: 2000,
          label: 'TRANSLATE_STATIC',
        }
      );

      if (result.error || !result.content) {
        throw new Error(result.error || 'Translation request failed or returned empty content');
      }

      return {
        translatedText: result.content.trim(),
        engineId,
        durationMs: Date.now() - startedAt,
      };
    }

    if (engineId.startsWith('local-model:')) {
      const instanceId = engineId.slice('local-model:'.length);
      const instances = this.getLocalSupervisor?.().list() ?? [];
      const inst = instances.find(item => item.id === instanceId);
      if (!inst || !inst.endpoint) throw new Error('Local model instance is not running');

      const isT3PO = inst.displayName.toLowerCase().includes('t3po');
      if (isT3PO) {
        const translator = new T3POStreamingTranslator({
          endpoint: inst.endpoint,
          sourceLanguage,
          targetLanguage,
          latencyMode: request.latencyMode,
          instructions: request.instructions,
          terminology: request.terminology,
        });
        translator.pushCommittedText(text);
        const translated = await translator.flush();
        return {
          translatedText: translated,
          engineId,
          durationMs: Date.now() - startedAt,
        };
      }

      // Generic local model chat completion
      const sourceLangName = toLanguageName(sourceLanguage);
      const targetLangName = toLanguageName(targetLanguage);
      const systemInstruction = `You are a professional translator. Translate the given text from ${sourceLangName.toLowerCase()} to ${targetLangName.toLowerCase()}. Output ONLY the translated text without explanations, greetings, or notes.`;
      const instructions = request.instructions ? `\nInstructions: ${request.instructions}` : '';

      let terms = '';
      if (Array.isArray(request.terminology) && request.terminology.length > 0) {
        terms = `\nTerminology Constraints:\n${request.terminology.join('\n')}`;
      }

      const result = await callNonStreamingChatCompletion(
        {
          type: 'openai-compatible',
          endpoint: `${inst.endpoint.replace(/\/+$/, '')}/v1`,
          apiKey: null,
          model: inst.displayName,
        },
        [
          { role: 'system', content: `${systemInstruction}${instructions}${terms}` },
          { role: 'user', content: text },
        ],
        {
          temperature: 0.1,
          maxTokens: 2000,
          label: 'TRANSLATE_LOCAL_MODEL',
        }
      );

      if (result.error || !result.content) {
        throw new Error(result.error || 'Local model translation request failed');
      }

      return {
        translatedText: result.content.trim(),
        engineId,
        durationMs: Date.now() - startedAt,
      };
    }

    throw new Error(`Unsupported translation engine: ${engineId}`);
  }

  public createStreamingTranslator(
    config: AudioSessionTranslationConfig,
    sourceLanguage: string,
    onEvent: (event: TranslationSessionEvent) => void,
  ): T3POStreamingTranslator {
    const { engineId, targetLanguage, latencyMode, instructions, terminology } = config;

    let endpoint = '';
    let apiKey: string | undefined;
    let model = 'Confucius4-T3PO';

    if (engineId.startsWith('speech-provider:')) {
      const providerId = engineId.slice('speech-provider:'.length);
      const resolved = this.speechStore.require(providerId);
      const protocol = resolved.provider.protocol || '';
      if (!protocol.startsWith('t3po')) {
        throw new Error(
          `Speech provider "${resolved.provider.name}" uses speech recognition protocol "${protocol}", which does not support text translation.`
        );
      }
      endpoint = resolved.provider.endpoint;
      apiKey = resolved.credential ?? undefined;
      model = ((resolved.provider.options as unknown as Record<string, unknown>)?.model as string) || 'Confucius4-T3PO';
    } else if (engineId.startsWith('remote-ai:')) {
      const parts = engineId.slice('remote-ai:'.length).split(':');
      const providerId = parts[0];
      const modelName = parts.slice(1).join(':');
      const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as Record<string, unknown> | undefined;
      if (row) {
        endpoint = typeof row.endpoint === 'string' ? row.endpoint : '';
        if (typeof row.api_key_encrypted === 'string' && this.cryptoService.isUnlocked()) {
          apiKey = this.cryptoService.decrypt(row.api_key_encrypted);
        }
        model = modelName || (typeof row.model === 'string' ? row.model : 'gpt-4o');
      }
    } else if (engineId.startsWith('local-model:')) {
      const instanceId = engineId.slice('local-model:'.length);
      const instances = this.getLocalSupervisor?.().list() ?? [];
      const inst = instances.find(item => item.id === instanceId);
      if (inst?.endpoint) {
        endpoint = inst.endpoint;
        model = inst.displayName;
      }
    }

    const isWs = endpoint.startsWith('ws://') || endpoint.startsWith('wss://');
    if (!isWs) {
      throw new Error(`Model does not support streaming: endpoint protocol is not ws/wss (${endpoint || 'unconfigured'})`);
    }

    return new T3POStreamingTranslator({
      endpoint,
      apiKey,
      model,
      sourceLanguage,
      targetLanguage,
      latencyMode,
      instructions: instructions || defaultT3POInstructions(sourceLanguage, targetLanguage),
      terminology,
      onEvent,
    });
  }
}
