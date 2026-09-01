export interface McpProfileServerSelection {
  id: string;
  disabled_tools: string[];
}

export interface McpProfileSnapshotV1 {
  version: 1;
  global_enabled: boolean;
  servers: McpProfileServerSelection[];
}

export type StoredMcpProfile =
  | { kind: 'unmanaged' }
  | { kind: 'managed'; snapshot: McpProfileSnapshotV1 };

export interface McpStatus {
  globalEnabled: boolean;
  enabledServerCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidSnapshot(): never {
  throw new Error('Invalid MCP profile snapshot');
}

export function normalizeMcpProfileSnapshot(value: unknown): McpProfileSnapshotV1 {
  if (!isRecord(value) || value.version !== 1 || typeof value.global_enabled !== 'boolean' || !Array.isArray(value.servers)) {
    return invalidSnapshot();
  }

  const seenServerIds = new Set<string>();
  const servers: McpProfileServerSelection[] = [];
  for (const rawServer of value.servers) {
    if (!isRecord(rawServer) || typeof rawServer.id !== 'string' || !rawServer.id || !Array.isArray(rawServer.disabled_tools)) {
      return invalidSnapshot();
    }
    if (seenServerIds.has(rawServer.id)) continue;

    const disabledTools: string[] = [];
    const seenToolNames = new Set<string>();
    for (const toolName of rawServer.disabled_tools) {
      if (typeof toolName !== 'string' || !toolName) return invalidSnapshot();
      if (seenToolNames.has(toolName)) continue;
      seenToolNames.add(toolName);
      disabledTools.push(toolName);
    }

    seenServerIds.add(rawServer.id);
    servers.push({ id: rawServer.id, disabled_tools: disabledTools });
  }

  return {
    version: 1,
    global_enabled: value.global_enabled,
    servers,
  };
}

export function parseStoredMcpProfile(value: unknown): StoredMcpProfile {
  if (value === null || value === undefined) return { kind: 'unmanaged' };

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return invalidSnapshot();
    }
  }

  return { kind: 'managed', snapshot: normalizeMcpProfileSnapshot(parsed) };
}

export function isMcpStatusActive(status: McpStatus): boolean {
  return status.globalEnabled && status.enabledServerCount > 0;
}

export interface McpProfileDraft {
  globalEnabled: boolean;
  enabledServerIds: Iterable<string>;
  disabledToolsByServer: Record<string, string[]>;
}

// A profile always stores an MCP snapshot, so a globally disabled draft turns
// MCP off when applied instead of leaving the previous settings in place.
export function createMcpProfileSnapshot(draft: McpProfileDraft): McpProfileSnapshotV1 {
  return normalizeMcpProfileSnapshot({
    version: 1,
    global_enabled: draft.globalEnabled,
    servers: Array.from(draft.enabledServerIds, id => ({
      id,
      disabled_tools: draft.disabledToolsByServer[id] || [],
    })),
  });
}
