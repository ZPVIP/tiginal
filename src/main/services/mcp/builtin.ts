import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpClient, McpServerConfig, McpTool, McpError } from './types';
import { buildSpawnEnv, expandHome } from './env';
import { getDatabase } from '../../../services/database/database';

/**
 * Built-in MCP servers run inside the main process instead of spawning an
 * external package, so `fetch`, `python`, `ruby` and `filesystem` work with no
 * setup beyond having the interpreter installed.
 */

type Handler = (args: any, config: McpServerConfig) => Promise<string>;

interface BuiltinProvider {
  description: string;
  /**
   * Default `config` JSON seeded into the DB for a new server of this kind.
   * A function because some defaults depend on runtime settings.
   */
  defaults: () => McpServerConfig;
  tools: McpTool[];
  handlers: Record<string, Handler>;
}

// ---------------------------------------------------------------- interpreters

function runInterpreter(
  bin: string,
  makeArgs: (file: string) => string[],
  code: string,
  suffix: string,
  timeoutSec: number,
  cwd: string,
): Promise<string> {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `tiginal-mcp-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}${suffix}`);
    fs.writeFileSync(file, code, 'utf-8');

    const child = spawn(bin, makeArgs(file), {
      env: buildSpawnEnv(),
      cwd,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (text: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        fs.unlinkSync(file);
      } catch {
        /* best effort */
      }
      resolve(text);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(`Error: execution timed out after ${timeoutSec}s\n${stdout}${stderr}`);
    }, timeoutSec * 1000);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(`Error: failed to run ${bin}: ${err.message}`));
    child.on('close', (code) => {
      const body = [stdout, stderr].filter(Boolean).join('\n').trim();
      finish(code === 0 ? (body || '(no output)') : `Exit code ${code}\n${body}`);
    });
  });
}

function workspacePath(): string {
  const stored = getDatabase().getSetting('workspacePath');
  if (stored) return expandHome(stored);
  return path.join(os.homedir(), '.config', 'tiginal', 'workspaces');
}

// ------------------------------------------------------------------ filesystem

function allowedRoots(config: McpServerConfig): string[] {
  const raw = config.options?.allowedDirectories;
  const list = Array.isArray(raw) && raw.length > 0 ? raw : [workspacePath()];
  return list.map((p: string) => {
    const resolved = path.resolve(expandHome(String(p)));
    // Requested paths are canonicalized before the check, so the roots must be
    // too -- on macOS /var and /tmp are symlinks and would never match.
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  });
}

/**
 * Resolve a user-supplied path and refuse anything outside the allow-list.
 * Symlinks are resolved first so a link cannot escape the sandbox; for paths
 * that do not exist yet the closest existing parent is checked instead.
 */
function resolveInside(target: string, config: McpServerConfig): string {
  const roots = allowedRoots(config);
  const requested = path.resolve(expandHome(target));

  let probe = requested;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  let real = requested;
  try {
    const realProbe = fs.realpathSync(probe);
    real = path.join(realProbe, path.relative(probe, requested));
  } catch {
    /* fall back to the lexical path */
  }

  const inside = roots.some(root => real === root || real.startsWith(root + path.sep));
  if (!inside) {
    throw new McpError(`Access denied: "${target}" is outside the allowed directories (${roots.join(', ')})`);
  }
  return real;
}

function searchFiles(root: string, pattern: string, results: string[], limit: number): void {
  if (results.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const needle = pattern.toLowerCase();
  for (const entry of entries) {
    if (results.length >= limit) return;
    const full = path.join(root, entry.name);
    if (entry.name.toLowerCase().includes(needle)) results.push(full);
    if (entry.isDirectory() && !entry.isSymbolicLink()) searchFiles(full, pattern, results, limit);
  }
}

// -------------------------------------------------------------------- providers

const stringProp = (description: string) => ({ type: 'string', description });

export const BUILTIN_PROVIDERS: Record<string, BuiltinProvider> = {
  fetch: {
    description: 'Fetch a web page and return it as readable text',
    defaults: () => ({ type: 'builtin', provider: 'fetch', options: {} }),
    tools: [
      {
        name: 'fetch',
        description: 'Fetch a URL and return its content converted to readable text/markdown.',
        inputSchema: {
          type: 'object',
          properties: {
            url: stringProp('The absolute URL to fetch'),
            max_length: { type: 'number', description: 'Truncate the result to this many characters (default 20000)' },
          },
          required: ['url'],
        },
      },
    ],
    handlers: {
      fetch: async (args) => {
        const url = String(args?.url || '').trim();
        if (!url) throw new McpError('"url" is required');
        new URL(url); // throws on a malformed URL
        const { performWebFetch } = require('../../utils/BrowserUtils');
        const content: string = await performWebFetch(url);
        const max = Number(args?.max_length) > 0 ? Number(args.max_length) : 20000;
        return content.length > max ? `${content.slice(0, max)}\n\n[truncated at ${max} characters]` : content;
      },
    },
  },

  python: {
    description: 'Run Python code in a scratch file',
    defaults: () => ({ type: 'builtin', provider: 'python', options: { command: 'python3', timeout: 60 } }),
    tools: [
      {
        name: 'run_python',
        description: 'Execute Python code and return whatever it prints on stdout/stderr.',
        inputSchema: {
          type: 'object',
          properties: {
            code: stringProp('The Python source to execute'),
            timeout: { type: 'number', description: 'Seconds before the process is killed (default 60)' },
          },
          required: ['code'],
        },
      },
    ],
    handlers: {
      run_python: async (args, config) => {
        const code = String(args?.code ?? '');
        if (!code.trim()) throw new McpError('"code" is required');
        const bin = String(config.options?.command || 'python3');
        const timeout = Number(args?.timeout) > 0 ? Number(args.timeout) : Number(config.options?.timeout) || 60;
        return runInterpreter(bin, (f) => [f], code, '.py', timeout, workspacePath());
      },
    },
  },

  ruby: {
    description: 'Run Ruby code in a scratch file',
    defaults: () => ({ type: 'builtin', provider: 'ruby', options: { command: 'ruby', timeout: 60 } }),
    tools: [
      {
        name: 'run_ruby',
        description: 'Execute Ruby code and return whatever it prints on stdout/stderr.',
        inputSchema: {
          type: 'object',
          properties: {
            code: stringProp('The Ruby source to execute'),
            timeout: { type: 'number', description: 'Seconds before the process is killed (default 60)' },
          },
          required: ['code'],
        },
      },
    ],
    handlers: {
      run_ruby: async (args, config) => {
        const code = String(args?.code ?? '');
        if (!code.trim()) throw new McpError('"code" is required');
        const bin = String(config.options?.command || 'ruby');
        const timeout = Number(args?.timeout) > 0 ? Number(args.timeout) : Number(config.options?.timeout) || 60;
        return runInterpreter(bin, (f) => [f], code, '.rb', timeout, workspacePath());
      },
    },
  },

  filesystem: {
    description: 'Read and write files under an allow-list of directories',
    defaults: () => ({ type: 'builtin', provider: 'filesystem', options: { allowedDirectories: [workspacePath()] } }),
    tools: [
      {
        name: 'list_allowed_directories',
        description: 'List the directories this server is permitted to touch.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'read_file',
        description: 'Read a UTF-8 text file.',
        inputSchema: {
          type: 'object',
          properties: { path: stringProp('Path to the file') },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Create or overwrite a text file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: stringProp('Path to the file'),
            content: stringProp('The full new contents'),
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List the entries of a directory.',
        inputSchema: {
          type: 'object',
          properties: { path: stringProp('Path to the directory') },
          required: ['path'],
        },
      },
      {
        name: 'create_directory',
        description: 'Create a directory, including missing parents.',
        inputSchema: {
          type: 'object',
          properties: { path: stringProp('Path to create') },
          required: ['path'],
        },
      },
      {
        name: 'move_file',
        description: 'Move or rename a file or directory.',
        inputSchema: {
          type: 'object',
          properties: {
            source: stringProp('Existing path'),
            destination: stringProp('New path'),
          },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'search_files',
        description: 'Recursively find entries whose name contains a substring.',
        inputSchema: {
          type: 'object',
          properties: {
            path: stringProp('Directory to search from'),
            pattern: stringProp('Case-insensitive substring to match'),
          },
          required: ['path', 'pattern'],
        },
      },
      {
        name: 'get_file_info',
        description: 'Return size, type and timestamps for a path.',
        inputSchema: {
          type: 'object',
          properties: { path: stringProp('Path to inspect') },
          required: ['path'],
        },
      },
    ],
    handlers: {
      list_allowed_directories: async (_args, config) => allowedRoots(config).join('\n'),

      read_file: async (args, config) => {
        const file = resolveInside(String(args?.path || ''), config);
        return fs.readFileSync(file, 'utf-8');
      },

      write_file: async (args, config) => {
        const file = resolveInside(String(args?.path || ''), config);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(args?.content ?? ''), 'utf-8');
        return `Wrote ${Buffer.byteLength(String(args?.content ?? ''))} bytes to ${file}`;
      },

      list_directory: async (args, config) => {
        const dir = resolveInside(String(args?.path || ''), config);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (entries.length === 0) return '(empty directory)';
        return entries
          .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
          .join('\n');
      },

      create_directory: async (args, config) => {
        const dir = resolveInside(String(args?.path || ''), config);
        fs.mkdirSync(dir, { recursive: true });
        return `Created ${dir}`;
      },

      move_file: async (args, config) => {
        const from = resolveInside(String(args?.source || ''), config);
        const to = resolveInside(String(args?.destination || ''), config);
        fs.renameSync(from, to);
        return `Moved ${from} -> ${to}`;
      },

      search_files: async (args, config) => {
        const dir = resolveInside(String(args?.path || ''), config);
        const pattern = String(args?.pattern || '');
        if (!pattern) throw new McpError('"pattern" is required');
        const results: string[] = [];
        searchFiles(dir, pattern, results, 200);
        return results.length ? results.join('\n') : 'No matches';
      },

      get_file_info: async (args, config) => {
        const target = resolveInside(String(args?.path || ''), config);
        const stat = fs.statSync(target);
        return JSON.stringify(
          {
            path: target,
            type: stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modified: new Date(stat.mtimeMs).toISOString(),
            created: new Date(stat.birthtimeMs).toISOString(),
            mode: (stat.mode & 0o777).toString(8),
          },
          null,
          2,
        );
      },
    },
  },
};

/** An in-process client so built-ins go through the same code path as remotes. */
export class BuiltinClient implements McpClient {
  private readonly provider: BuiltinProvider;

  constructor(private readonly config: McpServerConfig) {
    const key = String(config.provider || '');
    const provider = BUILTIN_PROVIDERS[key];
    if (!provider) throw new McpError(`Unknown built-in MCP provider "${key}"`);
    this.provider = provider;
  }

  async listTools(): Promise<McpTool[]> {
    return this.provider.tools;
  }

  async callTool(name: string, args: any): Promise<string> {
    const handler = this.provider.handlers[name];
    if (!handler) throw new McpError(`Unknown tool "${name}"`);
    return handler(args, this.config);
  }

  async close(): Promise<void> {
    /* nothing to tear down */
  }
}
