import * as crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { CryptoService } from '../../services/ssh/CryptoService';
import {
  BUILT_IN_R2T2_TRIAL_ENDPOINT,
  BUILT_IN_R2T2_TRIAL_MAX_SECONDS,
  BUILT_IN_R2T2_TRIAL_TOKEN,
  BUILT_IN_T3PO_TRIAL_ENDPOINT,
  BUILT_IN_T3PO_TRIAL_TOKEN,
  SPEECH_AUTH_MODES,
  SPEECH_PROVIDER_PROTOCOLS,
  type R2T2ProviderOptions,
  type SpeechAuthMode,
  type SpeechProvider,
  type SpeechProviderInput,
  type SpeechProviderProtocol,
} from '../../shared/audio/types';
import { defaultR2T2ProviderOptions } from '../../shared/audio/r2t2';

interface SpeechProviderRow {
  id: string;
  name: string;
  protocol: SpeechProviderProtocol;
  endpoint: string;
  authMode: SpeechAuthMode;
  credentialEncrypted: string | null;
  builtInKind: 'r2t2-online-trial' | 't3po-online-trial' | null;
  userModified: boolean;
  maxSessionSeconds: number | null;
  defaultLanguage: string;
  options: R2T2ProviderOptions;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedSpeechProvider {
  provider: SpeechProvider;
  credential: string | null;
}

interface NormalizedEndpoint {
  endpoint: string;
  queryToken?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpeechProviderProtocol(value: unknown): value is SpeechProviderProtocol {
  return typeof value === 'string'
    && SPEECH_PROVIDER_PROTOCOLS.some(protocol => protocol === value);
}

function isSpeechAuthMode(value: unknown): value is SpeechAuthMode {
  return typeof value === 'string' && SPEECH_AUTH_MODES.some(mode => mode === value);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function parseOptions(value: unknown): R2T2ProviderOptions {
  const defaults = defaultR2T2ProviderOptions();
  if (!isRecord(value)) return defaults;
  return {
    bookedWords: parseStringArray(value.bookedWords),
    useVad: parseBoolean(value.useVad, defaults.useVad),
    smooth: parseBoolean(value.smooth, defaults.smooth),
    mode: typeof value.mode === 'string' && value.mode.trim()
      ? value.mode.trim().slice(0, 32)
      : defaults.mode,
    systemPrompt: typeof value.systemPrompt === 'string'
      ? value.systemPrompt.slice(0, 4_000)
      : defaults.systemPrompt,
  };
}

function parseOptionsJson(value: unknown): R2T2ProviderOptions {
  if (typeof value !== 'string') return defaultR2T2ProviderOptions();
  try {
    return parseOptions(JSON.parse(value));
  } catch {
    return defaultR2T2ProviderOptions();
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function optionalPositiveSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('maxSessionSeconds must be a positive integer or null');
  }
  return value;
}

export function normalizeSpeechEndpoint(rawEndpoint: string): NormalizedEndpoint {
  let url: URL;
  try {
    url = new URL(rawEndpoint.trim());
  } catch {
    throw new Error('Speech endpoint must be a valid WebSocket URL');
  }

  const isLoopback = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
    || url.hostname === '::1';
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLoopback)) {
    throw new Error('Remote speech endpoints must use wss://; ws:// is limited to loopback');
  }

  const queryToken = url.searchParams.get('t')?.trim() || undefined;
  url.searchParams.delete('t');
  return { endpoint: url.toString(), queryToken };
}

export function parseSpeechProviderInput(value: unknown, requireId = false): SpeechProviderInput {
  if (!isRecord(value)) throw new Error('Speech provider input must be an object');
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined;
  if (requireId && !id) throw new Error('Speech provider ID is required');
  if (!isSpeechProviderProtocol(value.protocol)) throw new Error('Unsupported speech protocol');
  if (!isSpeechAuthMode(value.authMode)) throw new Error('Unsupported speech authentication mode');
  if (
    (value.protocol === 'r2t2-rstream' || value.protocol === 't3po-rstream')
    && value.authMode === 'handshake-secret'
  ) {
    throw new Error(`${value.protocol} supports query-token or no authentication`);
  }
  if (
    (value.protocol === 'r2t2-native' || value.protocol === 't3po-native')
    && value.authMode === 'query-token'
  ) {
    throw new Error(`${value.protocol} supports handshake-secret or no authentication`);
  }

  return {
    ...(id ? { id } : {}),
    name: requiredString(value, 'name').slice(0, 120),
    protocol: value.protocol,
    endpoint: requiredString(value, 'endpoint'),
    authMode: value.authMode,
    ...(typeof value.credential === 'string' ? { credential: value.credential.trim() } : {}),
    maxSessionSeconds: optionalPositiveSeconds(value.maxSessionSeconds),
    defaultLanguage: requiredString(value, 'defaultLanguage').slice(0, 64),
    options: parseOptions(value.options),
    enabled: parseBoolean(value.enabled, true),
  };
}

function parseSpeechProviderRow(value: unknown): SpeechProviderRow {
  if (!isRecord(value)) throw new Error('Invalid speech provider row');
  const protocol = value.protocol;
  const authMode = value.auth_mode;
  if (!isSpeechProviderProtocol(protocol) || !isSpeechAuthMode(authMode)) {
    throw new Error('Speech provider row has an unsupported protocol or authentication mode');
  }
  const builtInKind = value.built_in_kind === 'r2t2-online-trial' || value.built_in_kind === 't3po-online-trial'
    ? value.built_in_kind
    : null;
  return {
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    protocol,
    endpoint: requiredString(value, 'endpoint'),
    authMode,
    credentialEncrypted: typeof value.credential_encrypted === 'string'
      ? value.credential_encrypted
      : null,
    builtInKind,
    userModified: value.user_modified === 1,
    maxSessionSeconds: typeof value.max_session_seconds === 'number'
      ? value.max_session_seconds
      : null,
    defaultLanguage: requiredString(value, 'default_language'),
    options: parseOptionsJson(value.options_json),
    enabled: value.enabled === 1,
    createdAt: typeof value.created_at === 'number' ? value.created_at : 0,
    updatedAt: typeof value.updated_at === 'number' ? value.updated_at : 0,
  };
}

function publicProvider(row: SpeechProviderRow): SpeechProvider {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    endpoint: row.endpoint,
    authMode: row.authMode,
    hasCredential: usesBundledTrialCredential(row) || row.credentialEncrypted !== null,
    builtInKind: row.builtInKind,
    userModified: row.userModified,
    maxSessionSeconds: row.maxSessionSeconds,
    defaultLanguage: row.defaultLanguage,
    options: row.options,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function usesBundledTrialCredential(row: SpeechProviderRow): boolean {
  if (row.credentialEncrypted !== null) return false;
  if (
    row.builtInKind === 'r2t2-online-trial'
    && row.protocol === 'r2t2-rstream'
    && row.authMode === 'query-token'
    && row.endpoint === BUILT_IN_R2T2_TRIAL_ENDPOINT
  ) return true;
  if (
    row.builtInKind === 't3po-online-trial'
    && row.protocol === 't3po-rstream'
    && row.authMode === 'query-token'
    && row.endpoint === BUILT_IN_T3PO_TRIAL_ENDPOINT
  ) return true;
  return false;
}

export class SpeechProviderStore {
  constructor(
    private readonly db: Database.Database,
    private readonly cryptoService: CryptoService,
  ) {}

  list(): SpeechProvider[] {
    const rows: unknown[] = this.db.prepare(`
      SELECT id, name, protocol, endpoint, auth_mode, credential_encrypted,
             built_in_kind, user_modified, max_session_seconds, default_language,
             options_json, enabled, created_at, updated_at
      FROM speech_providers
      ORDER BY built_in_kind IS NULL, name COLLATE NOCASE
    `).all();
    return rows.map(parseSpeechProviderRow).map(publicProvider);
  }

  add(input: SpeechProviderInput): SpeechProvider {
    const normalized = normalizeSpeechEndpoint(input.endpoint);
    const credential = input.credential ?? normalized.queryToken;
    const encryptedCredential = this.encryptCredential(credential);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO speech_providers (
        id, name, protocol, endpoint, auth_mode, credential_encrypted,
        built_in_kind, user_modified, max_session_seconds, default_language,
        options_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.protocol,
      normalized.endpoint,
      input.authMode,
      encryptedCredential,
      input.maxSessionSeconds,
      input.defaultLanguage,
      JSON.stringify(parseOptions(input.options)),
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
    return this.require(id).provider;
  }

  update(input: SpeechProviderInput & { id: string }): SpeechProvider {
    const existing = this.requireRow(input.id);
    const normalized = normalizeSpeechEndpoint(input.endpoint);
    const suppliedCredential = input.credential ?? normalized.queryToken;
    const credentialEncrypted = suppliedCredential === undefined
      ? existing.credentialEncrypted
      : this.encryptCredential(suppliedCredential);
    const now = Date.now();

    this.db.prepare(`
      UPDATE speech_providers SET
        name = ?, protocol = ?, endpoint = ?, auth_mode = ?, credential_encrypted = ?,
        user_modified = ?, max_session_seconds = ?, default_language = ?, options_json = ?,
        enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.protocol,
      normalized.endpoint,
      input.authMode,
      credentialEncrypted,
      1,
      input.maxSessionSeconds,
      input.defaultLanguage,
      JSON.stringify(parseOptions(input.options)),
      input.enabled === false ? 0 : 1,
      now,
      input.id,
    );
    return this.require(input.id).provider;
  }

  delete(id: string): void {
    this.requireRow(id);
    this.db.prepare('DELETE FROM speech_providers WHERE id = ?').run(id);
  }

  resolveForTest(input: SpeechProviderInput): ResolvedSpeechProvider {
    const normalized = normalizeSpeechEndpoint(input.endpoint);
    const existingRow = input.id ? this.requireRow(input.id) : null;
    const suppliedCredential = input.credential ?? normalized.queryToken;
    const proposedRow = existingRow ? {
      ...existingRow,
      protocol: input.protocol,
      endpoint: normalized.endpoint,
      authMode: input.authMode,
    } : null;
    let credential: string | null;
    if (suppliedCredential !== undefined) {
      credential = suppliedCredential || null;
    } else if (existingRow?.credentialEncrypted) {
      credential = this.decryptCredential(existingRow.credentialEncrypted);
    } else {
      credential = proposedRow && usesBundledTrialCredential(proposedRow)
        ? (proposedRow.builtInKind === 't3po-online-trial' ? BUILT_IN_T3PO_TRIAL_TOKEN : BUILT_IN_R2T2_TRIAL_TOKEN)
        : null;
    }
    const now = Date.now();
    return {
      provider: {
        id: input.id ?? 'unsaved-speech-provider',
        name: input.name,
        protocol: input.protocol,
        endpoint: normalized.endpoint,
        authMode: input.authMode,
        hasCredential: credential !== null,
        builtInKind: existingRow?.builtInKind ?? null,
        userModified: existingRow?.userModified ?? false,
        maxSessionSeconds: input.maxSessionSeconds,
        defaultLanguage: input.defaultLanguage,
        options: parseOptions(input.options),
        enabled: input.enabled !== false,
        createdAt: existingRow?.createdAt ?? now,
        updatedAt: now,
      },
      credential,
    };
  }

  require(id: string): ResolvedSpeechProvider {
    const row = this.requireRow(id);
    let credential: string | null = null;
    if (usesBundledTrialCredential(row)) {
      credential = row.builtInKind === 't3po-online-trial' ? BUILT_IN_T3PO_TRIAL_TOKEN : BUILT_IN_R2T2_TRIAL_TOKEN;
    } else if (row.credentialEncrypted) {
      credential = this.decryptCredential(row.credentialEncrypted);
    }
    return { provider: publicProvider(row), credential };
  }

  private requireRow(id: string): SpeechProviderRow {
    const row: unknown = this.db.prepare(`
      SELECT id, name, protocol, endpoint, auth_mode, credential_encrypted,
             built_in_kind, user_modified, max_session_seconds, default_language,
             options_json, enabled, created_at, updated_at
      FROM speech_providers WHERE id = ?
    `).get(id);
    if (!row) throw new Error('Speech provider not found');
    return parseSpeechProviderRow(row);
  }

  private encryptCredential(credential: string | undefined): string | null {
    if (!credential) return null;
    if (!this.cryptoService.isUnlocked()) {
      throw new Error('Unlock credential storage before saving a speech token');
    }
    return this.cryptoService.encrypt(credential);
  }

  private decryptCredential(encryptedCredential: string): string {
    if (!this.cryptoService.isUnlocked()) {
      throw new Error('Unlock credential storage before using this speech provider');
    }
    return this.cryptoService.decrypt(encryptedCredential);
  }
}
