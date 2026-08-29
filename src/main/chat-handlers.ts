import { ipcMain } from 'electron';
import { getDatabase } from '../services/database/database';
import { getCrypto } from '../services/ssh/CryptoService';
import { getChatService, Conversation, Message } from '../services/ai/ChatService';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'copilot';
  endpoint?: string;
  model: string;
}


import { getCopilotToken } from './services/ai/CopilotAuthService';
import { printRequestEndSeparator, printRequestStartSeparator, printRespondEndSeparator, printRespondStartSeparator, printVisualSeparator } from './utils/DebugUtils';
import { fetchWithLocalhostFallback } from './utils/NetworkUtils';
import { buildDynamicPromptSectionsForAI } from './dynamic-prompts';
import { getMcpService } from './services/mcp/McpService';
import { getContextWindow, setOverride as setContextWindowOverride } from './services/context-window';
import { toModelDataUrl, deleteImages } from './image-handlers';
import { expandHome, normalizeForCompare, workspaceDir } from './utils/paths';
import {
  aggregateCacheUsage,
  canonicalizeToolDefinitions,
  isAnthropicEndpoint,
  normalizeOpenAIUsage,
  NormalizedUsage,
} from './services/ai/cache-usage';
import { streamAnthropicAPI } from './services/ai/anthropic-stream';
import {
  applyCompletionTokenLimit,
  fetchOpenAIWithCompatibility,
} from './services/ai/openai-request';
import {
  JsonObject,
  parseStoredJsonObject,
  prepareToolInput,
} from './services/tools/tool-input';
import {
  analyzeNonShellTool,
  isToolRiskLevel,
  ToolApprovalAnalysis,
} from './services/tools/tool-approval';
import { performSearch } from './services/search';

interface LogAccumulator {
    id?: string;
    model?: string;
    created?: number;
    role?: string;
    contentParts: string[];
    reasoningParts: string[];
    toolCalls: any[];
    usage?: any;
}

// Module-level state for tool approvals
const pendingToolApprovals = new Map<string, (result: { approved: boolean; approvedAll: boolean }) => void>();

// Module-level state for stream abort controllers
const activeStreamControllers = new Map<string, AbortController>();

// Tool Definitions
const TOOL_SEARCH_DEF = {
  name: "ToolSearch",
  description: "Search and discover available tools using semantic search.\nUse this tool to find relevant tools when you need to:\n- Discover what tools are available for a specific task\n- Find MCP server tools by describing what you want to do\n- Get tool definitions and input schemas before using them\n- Explore capabilities across built-in and MCP tools\n\nThis tool uses AI to understand your query and find matching tools semantically.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        description: "Search query to find tools - describe what you want to do or the type of tool you need"
      },
      type: {
        default: "all",
        description: "Filter by tool type: 'builtin' for built-in tools, 'mcp' for MCP server tools, 'plugin' for plugin-registered tools, or 'all' for all",
        type: "string",
        enum: ["builtin", "mcp", "plugin", "all"]
      },
      limit: {
        default: 20,
        description: "Maximum number of tools to return",
        type: "integer",
        exclusiveMinimum: 0,
        maximum: 50
      }
    },
    required: ["query"],
    additionalProperties: false
  }
};

const ATTEMPT_COMPLETION_DEF = {
  name: "AttemptCompletion",
  description: "Signal that the task is completed with a final results summary.",
  input_schema: {
    type: "object",
    properties: {
      result: {
        type: "string",
        description: "Final result summary of the task execution"
      }
    },
    required: ["result"],
    additionalProperties: false
  }
};

const LOCAL_EXECUTABLE_TOOLS = new Set([
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'ExecuteSkill',
]);

function hasToolExecutor(toolName: string): boolean {
  return LOCAL_EXECUTABLE_TOOLS.has(toolName) || getMcpService().isMcpTool(toolName);
}

function buildToolSearchPrompt(db: any): string {
  try {
    const rows = db.prepare(`
      SELECT t.name, t.description, tc.name as category
      FROM tools t
      LEFT JOIN tool_categories tc ON t.category_id = tc.id
      WHERE t.enabled = 1 AND (tc.enabled IS NULL OR tc.enabled = 1)
      ORDER BY tc.rank ASC, t.name ASC
    `).all() as Array<{ name: string; description: string; category: string }>;

    let toolsList = '';
    
    if (rows.length === 0) {
       toolsList = '[]';
    } else {
       // Format as JSON to handle multiline descriptions gracefully
       const tools = rows.map(row => ({
           name: row.name,
           category: row.category || 'General',
           description: row.description || ''
       }));
       toolsList = JSON.stringify(tools, null, 2);
    }

    return `You are a tool search assistant. Your task is to find tools that match the user's search query.

Below is a list of available tools in JSON format:

${toolsList}

Based on the search query, select all tools that are relevant. Return your response as a JSON object with:
- "tools": an array of tool names (strings) that match the search query
- "reasoning": a brief explanation of why these tools were selected

Guidelines:
1. Select tools that semantically match what the user is looking for
2. If the query is broad, include multiple relevant tools
3. If no tools match, return an empty array
`;
  } catch (error) {
    console.error('Failed to build tool search prompt:', error);
    return `You are a tool search assistant. Find relevant tools.
    
Available tools:
- Task: [builtin] Launch sub-agents
- Bash: [builtin] Run shell commands
- WebSearch: [builtin] Search the web

Return JSON with "tools" array.`;
  }
}

/**
 * Setup Chat-related IPC handlers
 */
export function setupChatHandlers(): void {
  // Get all conversations
  ipcMain.handle('chat:get-conversations', async (): Promise<Conversation[]> => {
    return getChatService().getAllConversations();
  });

  // Get messages for a conversation
  ipcMain.handle('chat:get-messages', async (_event, conversationId: string): Promise<Message[]> => {
    return getChatService().getMessages(conversationId);
  });

  // Get conversation tokens (live from DB)
  ipcMain.handle('chat:get-conversation-tokens', async (_event, conversationId: string): Promise<string | null> => {
    const db = getDatabase().getDb();
    const row = db.prepare('SELECT tokens FROM conversations WHERE id = ?').get(conversationId) as { tokens: string | null } | undefined;
    return row?.tokens || null;
  });

  // Create new conversation
  ipcMain.handle('chat:create-conversation', async (_event, providerId?: string, isTransient: boolean = false): Promise<Conversation> => {
    return getChatService().createConversation(providerId, isTransient);
  });

  // Add message
  ipcMain.handle('chat:add-message', async (
    _event, 
    conversationId: string, 
    role: 'user' | 'assistant' | 'system', 
    content: string
  ): Promise<Message> => {
    return getChatService().addMessage(conversationId, role, content);
  });

  // Delete conversation
  ipcMain.handle('chat:delete-conversation', async (_event, id: string): Promise<void> => {
    // Attachments live on disk, so removing the rows alone would orphan them.
    try {
      deleteImages(collectRemovableImages(id));
    } catch (e) {
      console.error('[Chat] Failed to clean up attachments', e);
    }
    getChatService().deleteConversation(id);
  });

  // Update conversation title
  ipcMain.handle('chat:update-title', async (_event, id: string, title: string): Promise<void> => {
    getChatService().updateTitle(id, title);
  });

  // Set last used model for a provider
  ipcMain.handle('chat:set-last-model', async (_event, { providerId, model }: { providerId: string; model: string }): Promise<void> => {
      const db = getDatabase().getDb();
      
      // Use transaction to atomically update model and default status
      const update = db.transaction(() => {
          // Clear existing default
          db.prepare('UPDATE ai_providers SET is_default = 0').run();
          // Update the model for this provider so it sticks, and make it default
          db.prepare('UPDATE ai_providers SET model = ?, is_default = 1 WHERE id = ?').run(model, providerId);
      });
      
      update();
  });

  // ===== Category Handlers =====

  // Get all categories
  ipcMain.handle('chat:get-categories', async () => {
    return getChatService().getAllCategories();
  });

  // Create new category
  ipcMain.handle('chat:create-category', async (_event, name: string) => {
    return getChatService().createCategory(name);
  });

  // Update category name
  ipcMain.handle('chat:update-category', async (_event, id: number, name: string) => {
    return getChatService().updateCategory(id, name);
  });

  // Delete category
  ipcMain.handle('chat:delete-category', async (_event, id: number) => {
    return getChatService().deleteCategory(id);
  });

  // Toggle category pinned
  ipcMain.handle('chat:toggle-category-pinned', async (_event, id: number, pinned: boolean) => {
    return getChatService().toggleCategoryPinned(id, pinned);
  });

  // Toggle category expanded
  ipcMain.handle('chat:toggle-category-expanded', async (_event, id: number, expanded: boolean) => {
    return getChatService().toggleCategoryExpanded(id, expanded);
  });

  // Reorder categories
  ipcMain.handle('chat:reorder-categories', async (_event, ids: number[]) => {
    return getChatService().reorderCategories(ids);
  });

  // ===== Enhanced Conversation Handlers =====

  // Move conversation to category
  ipcMain.handle('chat:move-conversation', async (_event, conversationId: string, categoryId: number) => {
    return getChatService().moveConversation(conversationId, categoryId);
  });

  // Toggle conversation pinned
  ipcMain.handle('chat:toggle-conversation-pinned', async (_event, id: string, pinned: boolean) => {
    return getChatService().toggleConversationPinned(id, pinned);
  });

  // Toggle conversation favorite
  ipcMain.handle('chat:toggle-conversation-favorite', async (_event, id: string, favorite: boolean) => {
    return getChatService().toggleConversationFavorite(id, favorite);
  });

  // Get conversations by category with pagination
  ipcMain.handle('chat:get-conversations-by-category', async (_event, categoryId: number, page: number, pageSize: number, sortBy?: 'updatedAt' | 'createdAt') => {
    return getChatService().getConversationsByCategory(categoryId, page, pageSize, sortBy);
  });

  // Get favorite conversations with pagination
  ipcMain.handle('chat:get-favorite-conversations', async (_event, page: number, pageSize: number, sortBy?: 'updatedAt' | 'createdAt') => {
    return getChatService().getFavoriteConversations(page, pageSize, sortBy);
  });

  // Rename conversation (alias for update-title)
  ipcMain.handle('chat:rename-conversation', async (_event, id: string, title: string) => {
    return getChatService().updateTitle(id, title);
  });

  // Set current category
  ipcMain.handle('chat:set-current-category', async (_event, id: number) => {
    return getChatService().setCurrentCategory(id);
  });

  // Get current category ID
  ipcMain.handle('chat:get-current-category', async () => {
    return getChatService().getCurrentCategoryId();
  });
  // Submit tool approval (User clicked Allow/Deny)
  ipcMain.handle('chat:submit-tool-approval', async (_event, { toolCallId, approved, approvedAll }: { toolCallId: string; approved: boolean; approvedAll: boolean }): Promise<void> => {
      const resolver = pendingToolApprovals.get(toolCallId);
      if (resolver) {
          resolver({ approved, approvedAll });
          pendingToolApprovals.delete(toolCallId);
      }
  });

  // Stop stream (User clicked Stop button)
  ipcMain.handle('chat:stop-stream', async (_event, conversationId: string): Promise<void> => {
      const controller = activeStreamControllers.get(conversationId);
      if (controller) {
          controller.abort();
          activeStreamControllers.delete(conversationId);
      }
  });

  // Send message to AI (Autonomous Agent Loop)
  ipcMain.handle('chat:send-message', async (_event, conversationId: string, providerId: string, content: string, specificModel?: string, options: { useSystemPrompt?: boolean, useSkills?: boolean, images?: string[] } = {}): Promise<{ response: string; error?: string }> => {
    return runAgentLoop(_event, conversationId, providerId, content, specificModel, options);
  });

  // How many tokens the current provider/model can hold, for the context ring
  ipcMain.handle('chat:get-context-window', async (_event, providerId: string, modelId: string) => {
    return getContextWindow(providerId, modelId);
  });

  // Servers that expose no metadata need the window set by hand
  ipcMain.handle('chat:set-context-window', async (_event, providerId: string, modelId: string, tokens: number | null) => {
    setContextWindowOverride(providerId, modelId, tokens);
    return getContextWindow(providerId, modelId);
  });

  // Execute a tool (called after user approves)
  ipcMain.handle('chat:execute-tool', async (_event, toolName: string, toolInput: any): Promise<{ success: boolean; result?: string; error?: string }> => {
    try {
      if (toolName === 'Bash') {
        // Execute bash command
        const { exec } = require('child_process');
        const workspacePath = workspaceDir();
        
        return new Promise((resolve) => {
          exec(toolInput.command, { cwd: workspacePath, timeout: 60000 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
              resolve({ success: false, error: error.message, result: stderr });
            } else {
              resolve({ success: true, result: stdout || stderr || 'Command executed successfully' });
            }
          });
        });
      }

      // Handle "Skill" or "ExecuteSkill" tool
      if (toolName.toLowerCase() === 'skill' || toolName.toLowerCase() === 'executeskill') {
          const db = getDatabase().getDb();
          const path = require('path');
          const fs = require('fs');
          const os = require('os');
          
          const skillNameInput = toolInput.skill || toolInput.name;
          if (!skillNameInput) {
              return { success: false, error: 'Skill name is required in arguments' };
          }

          // Fetch all skills to perform fuzzy matching
          const allSkills = db.prepare('SELECT * FROM skills').all() as any[];
          
          // Normalize string helper: lowercase and remove non-alphanumeric chars
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const target = normalize(skillNameInput);
          
          const skill = allSkills.find(s => normalize(s.name) === target || normalize(s.skill_folder) === target); // Also match folder name
          
          if (!skill) {
              // Try partial match or more lenient if needed, but exact normalized match is usually enough
              return { success: false, error: `Skill not found: ${skillNameInput}` };
          }
          
          // Get directory
          const dir = db.prepare('SELECT path FROM skill_directories WHERE id = ?').get(skill.skill_directory_id) as any;
          if (!dir) {
               return { success: false, error: 'Skill directory configuration error' };
          }
          
          // Helper to expand path
          const expandPath = expandHome;
          const fullPath = path.join(expandPath(dir.path), skill.skill_folder);
          const skillMdPath = path.join(fullPath, 'SKILL.md');
          
          if (fs.existsSync(skillMdPath)) {
               const content = fs.readFileSync(skillMdPath, 'utf-8');
               const resultMsg = `Skill Documentation for "${skill.name}":\n\n${content}\n\n[SYSTEM]: Skill instructions loaded. Use the Bash tool to execute the commands or scripts described above.`;
               return { success: true, result: resultMsg };
          } else {
               return { success: false, error: 'SKILL.md not found in skill folder' };
          }
      }
      
      // Unknown tool
      return { success: false, error: `Unknown tool: ${toolName}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

/**
 * Shared helper: Make a non-streaming chat completion API call.
 * Used by analyzeCommand, callToolsModel, and generateConversationTitle.
 * Returns the response content string, or null on failure.
 */
interface NonStreamingAPIConfig {
  type: 'openai-compatible' | 'copilot';
  endpoint: string;
  apiKey: string | null;
  model: string;
  autoCORSFix?: boolean;
  customHeaders?: Record<string, string>;
}

async function callNonStreamingChatCompletion(
  config: NonStreamingAPIConfig,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number; label?: string }
): Promise<{ content: string | null; usage?: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.customHeaders || {})
  };

  let endpoint = config.endpoint || 'https://api.openai.com/v1';

  if (config.type === 'copilot' && config.apiKey) {
    if (!endpoint || endpoint.includes('api.openai.com')) {
      endpoint = 'https://api.githubcopilot.com';
    }
    const copilotToken = await getCopilotToken(config.apiKey);
    headers['Authorization'] = `Bearer ${copilotToken}`;
    headers['Copilot-Integration-Id'] = 'vscode-chat';
    headers['Editor-Version'] = 'vscode/1.107.0';
    headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
    headers['User-Agent'] = 'GitHubCopilotChat/0.35.0';
    headers['Openai-Intent'] = 'conversation-edits';
  } else if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  if (config.autoCORSFix !== false) {
    try { const url = new URL(endpoint); headers['Origin'] = url.origin; } catch (e) {}
  }

  const bodyPayload = applyCompletionTokenLimit({
    model: config.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    stream: false
  }, endpoint, options?.maxTokens ?? 1000);

  const label = options?.label || 'NON_STREAMING';

  printRequestStartSeparator();
  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`\n--- ${label} REQUEST ---\n`);
    process.stdout.write('URL: ' + `${endpoint}/chat/completions` + '\n');
    const safeHeaders = { ...headers };
    if (safeHeaders['Authorization']) safeHeaders['Authorization'] = 'Bearer [HIDDEN]';
    process.stdout.write('Headers: ' + JSON.stringify(safeHeaders, null, 2) + '\n');
    process.stdout.write('Body: ' + JSON.stringify(bodyPayload, null, 2) + '\n');
  }

  const result = await fetchOpenAIWithCompatibility(fetchWithLocalhostFallback, `${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
  }, bodyPayload);
  const response = result.response;

  printRequestEndSeparator();

  if (!response.ok) {
    const errorText = result.errorText ?? await response.text();
    console.error(`${label} API failed: ${response.status} - ${errorText}`);
    return { content: null, usage: undefined };
  }

  const data = await response.json() as any;

  if (process.env.NODE_ENV !== 'production') {
    printRespondStartSeparator();
    process.stdout.write(`\n--- ${label} RESPONSE ---\n`);
    process.stdout.write('Status: ' + response.status + '\n');
    process.stdout.write('Body: ' + JSON.stringify(data, null, 2) + '\n');
    printRespondEndSeparator();
  }

  return { content: data.choices?.[0]?.message?.content || null, usage: data.usage };
}

/**
 * Security Analyzer: Analyze a bash command for risk and risk description
 */
async function analyzeCommand(
  command: string, 
  apiConfig: { 
      type: 'openai-compatible' | 'copilot',
      endpoint: string,
      apiKey: string | null,
      model: string
  }
): Promise<ToolApprovalAnalysis> {
    const prompt = `You are a security analyzer for shell commands. Your task is to analyze a bash command and determine:
1. Whether it needs user permission before execution
2. A brief description of what the command does (IMPORTANT: write the description in Chinese (Simplified))
3. The risk level of the command

Commands that are SAFE and do NOT need permission (return needsPermission: false):
- Read-only commands: ls, pwd, cat, head, tail, less, more, file, stat, wc, du, df, find (without -exec/-delete), locate, which, whereis, type, echo, printf
- Information commands: date, cal, uptime, whoami, id, groups, hostname, uname, env, printenv
- Text processing (read-only): grep, awk, sed (without -i), sort, uniq, cut, tr, diff, comm
- Git read commands: git status, git log, git diff, git branch, git show, git remote -v
- Package info: npm list, pip list, cargo --version, node --version, python --version
- Process info: ps, top (non-interactive), pgrep, jobs

Commands that NEED permission (return needsPermission: true):
- File modification: rm, mv, cp, mkdir, rmdir, touch, chmod, chown, ln
- File editing: sed -i, any editor commands
- Git write commands: git add, git commit, git push, git pull, git checkout, git merge, git rebase
- Package management: npm install, pip install, apt install, brew install, cargo install
- Process control: kill, killall, pkill, nohup, disown
- Network commands: curl (POST/PUT/DELETE), wget, ssh, scp, rsync
- System commands: sudo, su, systemctl, service, mount, umount
- Script execution: bash script.sh, ./script.sh, python script.py, node script.js
- Any command with pipes to write operations
- Any command with output redirection (>, >>)
- Any unknown or complex commands
- yt-dlp used for downloading videos (medium risk)

Respond with JSON only:
{
  "needsPermission": boolean,
  "description": "Brief description of what this command does in Chinese (Simplified)",
  "riskLevel": "safe" | "low" | "medium" | "high"
}

Risk levels:
- safe: Read-only, no side effects
- low: Minor changes, easily reversible
- medium: Significant changes, may affect files or system state
- high: Destructive operations, system modifications, network access`;

    try {
        const messages = [
            { role: 'system', content: prompt },
            { role: 'user', content: `Analyze this bash command: ${command}` }
        ];

        const analyzerResult = await callNonStreamingChatCompletion(
            { type: apiConfig.type, endpoint: apiConfig.endpoint, apiKey: apiConfig.apiKey, model: apiConfig.model },
            messages,
            { temperature: 0.1, maxTokens: 1000, label: 'ANALYZE COMMAND' }
        );

        if (analyzerResult.content) {
            const jsonMatch = analyzerResult.content.match(/```json\n([\s\S]*?)\n```/) || analyzerResult.content.match(/{[\s\S]*}/);
            const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : analyzerResult.content;
            try {
                const result = JSON.parse(jsonStr);
                return {
                    needsPermission: result.needsPermission === true,
                    description: result.description || `Execute: ${command}`,
                    riskLevel: isToolRiskLevel(result.riskLevel) ? result.riskLevel : 'medium'
                };
            } catch (e) {
                console.warn('Failed to parse analyzer response', analyzerResult.content);
            }
        }
        
    } catch (e) {
        console.error('Analyzer execution error', e);
    }
    
    return { needsPermission: true, description: `Execute: ${command}`, riskLevel: 'medium' };
}

/**
 * Stream AI API
 */
async function streamAIAPI(
  type: 'openai-compatible' | 'copilot',
  endpoint: string,
  apiKey: string | null,
  model: string,
  messages: any[],
  customHeaders: Record<string, string> = {},
  autoCORSFix: boolean = true,
  tools: Array<{ name: string; description: string; input_schema: object }> = [],
  onChunk: (data: { content?: string; reasoning?: string }) => void,
  onToolCall?: (data: { id: string; name: string; input: any }) => void | Promise<void>,
  abortSignal?: AbortSignal
): Promise<{ usage: NormalizedUsage }> {
  const stableTools = canonicalizeToolDefinitions(tools);

  if (type !== 'copilot' && isAnthropicEndpoint(endpoint)) {
    return streamAnthropicAPI({
      endpoint,
      apiKey,
      model,
      messages,
      customHeaders,
      tools: stableTools,
      onChunk,
      onToolCall,
      abortSignal,
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders
  };

  if (type === 'copilot' && apiKey) {
      if (!endpoint || endpoint.includes('api.openai.com')) {
           endpoint = 'https://api.githubcopilot.com'; 
      }

      try {
          const copilotToken = await getCopilotToken(apiKey);
          headers['Authorization'] = `Bearer ${copilotToken}`;
          headers['Copilot-Integration-Id'] = 'vscode-chat';
          headers['Editor-Version'] = 'vscode/1.107.0'; 
          headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
          headers['User-Agent'] = 'GitHubCopilotChat/0.35.0'; 
          headers['Openai-Intent'] = 'conversation-edits';
      } catch (err) {
          console.error("Copilot Token Exchange Failed", err);
          throw err;
      }
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (autoCORSFix) {
    try {
      const url = new URL(endpoint);
      headers['Origin'] = url.origin;
    } catch (e) {
      // invalid url
    }
  }

  const bodyPayload = applyCompletionTokenLimit({
    model,
    messages,
    temperature: 0.7,
    stream: true,
    stream_options: { include_usage: true },
  }, endpoint, 4000);

  if (stableTools.length > 0) {
    bodyPayload.tools = stableTools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }
    }));
    bodyPayload.tool_choice = 'auto';
  }

  if (process.env.NODE_ENV !== 'production') {
      printRequestStartSeparator();
      process.stdout.write('\n--- STREAM AI API REQUEST ---\n');
      process.stdout.write('URL: ' + `${endpoint}/chat/completions` + '\n');
      const safeHeaders = { ...headers };
      if (safeHeaders['Authorization']) safeHeaders['Authorization'] = 'Bearer [HIDDEN]';
      process.stdout.write('Headers: ' + JSON.stringify(safeHeaders, null, 2) + '\n');
      process.stdout.write('Body: ' + JSON.stringify(bodyPayload, null, 2) + '\n');
  }


  let response: Response;
  let responseErrorText: string | undefined;
  try {
    const result = await fetchOpenAIWithCompatibility(fetchWithLocalhostFallback, `${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        signal: abortSignal,
    }, bodyPayload);
    response = result.response;
    responseErrorText = result.errorText;
  } catch (error: any) {
      // Handle abort
      if (error.name === 'AbortError') {
          onChunk({ content: '\n\n*[Generation stopped]*' });
          return { usage: normalizeOpenAIUsage(undefined) };
      }
      // Handle Network Errors (like Offline)
      console.error('Fetch Error:', error);
      
      const isConnectionRefused = error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed');
      
      if (isConnectionRefused) {
        const friendlyMessage = 
          `> **Connection Error: Model Not Reachable**\n` +
          `>\n` +
          `> Unable to connect to the AI model at \`${endpoint}\`.\n` +
          `> \n` +
          `> **Possible causes:**\n` +
          `> - The model server (e.g., Ollama, LM Studio) is not running.\n` +
          `> - The configured endpoint URL is incorrect.\n` +
          `> - A firewall or network issue is blocking the connection.\n` +
          `> \n` +
          `> *Please check your AI Provider settings and ensure the local server is running.*`;
          
          if (onChunk) onChunk({ content: friendlyMessage });
          throw new Error('DISPLAY_ONLY_ERROR');
      }
      throw error;
  }

  printRequestEndSeparator();

  if (!response.ok) {
    const errorText = responseErrorText ?? await response.text();
    console.error(`AI API Error: ${response.status} - ${errorText}`);

    if (type === 'copilot' && response.status === 400) {
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error?.code === 'model_not_supported') {
                 const friendlyMessage = 
                    ` **GitHub Copilot Error: Model Not Supported**\n` +
                    `\n` +
                    `The requested model is not available. This is usually because:\n` +
                    `\n` +
                    `- You may not have a GitHub Copilot Pro subscription.\n` +
                    `- Your organization's policy settings might be restricting this model.\n` +
                    `\n` +
                    `Please check your settings: [https://github.com/settings/copilot/features](https://github.com/settings/copilot/features)`;
                 
                 onChunk({ content: friendlyMessage });
                 return { usage: normalizeOpenAIUsage(undefined) };
            }
        } catch (e) {
            // ignore JSON parse error
        }
    }

    let errorMessage = errorText;
    try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
        } else if (errorJson.error) {
            errorMessage = JSON.stringify(errorJson.error); 
        }
    } catch (e) {
        // use raw text
    }

    const genericErrorMsg = 
        `> **AI Provider Error (${response.status})**\n` +
        `>\n` +
        `> ${errorMessage}`;

    onChunk({ content: genericErrorMsg });
    return { usage: normalizeOpenAIUsage(undefined) };
  }

  if (!response.body) {
     throw new Error('No response body for stream');
  }

  if (process.env.NODE_ENV !== 'production') {
      console.log(`Stream started. Status: ${response.status}, Type: ${response.headers.get('content-type')}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  
  // Accumulator for tool calls across chunks
  const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};
  
  // Log accumulator for console output
  const logAccumulator: LogAccumulator = {
      contentParts: [],
      reasoningParts: [],
      toolCalls: []
  };

  // Tracks <think> tags for models that inline their reasoning in content
  const thinkState: ThinkTagState = { inThink: false, pending: '' };

  try {
    while (true) {
        // Check if aborted
        if (abortSignal?.aborted) {
            reader.cancel();
            onChunk({ content: '\n\n*[Generation stopped]*' });
            break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";  

        for (const line of lines) {
           processLine(line, onChunk, toolCallAccumulator, logAccumulator, thinkState);
        }
    }
    
    // Process remaining buffer (only if not aborted)
    if (buffer.trim() && !abortSignal?.aborted) {
        processLine(buffer, onChunk, toolCallAccumulator, logAccumulator, thinkState);
    }

    // Flush a held-back partial tag that never completed
    if (thinkState.pending) {
        const leftover = thinkState.pending;
        thinkState.pending = '';
        onChunk(thinkState.inThink ? { reasoning: leftover } : { content: leftover });
    }

    // Finalize any pending tool calls after stream ends (only if not aborted)
    if (onToolCall && !abortSignal?.aborted) {
        const toolsToCall = Object.values(toolCallAccumulator);
        for (const tool of toolsToCall) {
            // Check abort before each tool call
            if (abortSignal?.aborted) break;
            
            try {
                if (tool.name && tool.arguments) {
                     const input = JSON.parse(tool.arguments);
                     await onToolCall({
                         id: tool.id,
                         name: tool.name,
                         input
                     });
                }
            } catch (e) {
                console.warn('Failed to parse pending tool call at stream end', e);
            }
        }
    }

    // Print Consolidated Log
    printRespondStartSeparator();
    printLogAccumulator(logAccumulator);
    printRespondEndSeparator();

  } catch (err) {
      console.error('Stream read error:', err);
      throw err;
  }

  return { usage: normalizeOpenAIUsage(logAccumulator.usage) };
}

async function runAgentLoop(_event: any, conversationId: string, providerId: string, content: string, specificModel?: string, options: { useSystemPrompt?: boolean, useSkills?: boolean, images?: string[] } = {}): Promise<{ response: string; error?: string }> {
    const chatService = getChatService();
    const db = getDatabase().getDb();
    const dbService = getDatabase();
    const crypto = getCrypto();
    const MAX_TURNS = 10;
    
    // 1. Setup Provider & API Key
    const provider = db.prepare(`SELECT * FROM ai_providers WHERE id = ?`).get(providerId) as any;
    if (!provider) return { response: '', error: 'Provider not found' };

    let apiKey: string | null = null;
    if (provider.api_key_encrypted && crypto.isUnlocked()) {
        try { apiKey = crypto.decrypt(provider.api_key_encrypted); } catch {}
    }
    const modelToUse = specificModel || provider.model;
    const customHeaders = provider.custom_headers ? JSON.parse(provider.custom_headers) : {};
    
    // 2. Build Initial Messages
    chatService.addMessage(conversationId, 'user', content, undefined, undefined, undefined, options.images);
    const dbMessages = chatService.getMessages(conversationId);

    // Auto-generate title for new conversations (first user message)
    const userMessages = dbMessages.filter(m => m.role === 'user');
    if (userMessages.length === 1) {
      // Fire and forget: generate title asynchronously without blocking the main response
      generateConversationTitle(
        content,
        provider,
        apiKey,
        modelToUse,
        customHeaders,
        conversationId,
        chatService,
        _event.sender
      ).catch(err => console.error('Title generation failed:', err));
    }
    
    // Construct System Prompt from system_prompts table
    // Check global system prompts switch from database
    const globalSystemPromptsVal = dbService.getSetting('systemPromptsGlobalEnabled');
    const useSystemPrompt = globalSystemPromptsVal !== 'false'; // Default to true
    
    // Check category switches
    const defaultCategoryVal = dbService.getSetting('systemPromptsDefaultEnabled');
    const customCategoryVal = dbService.getSetting('systemPromptsCustomEnabled');
    const defaultCategoryEnabled = defaultCategoryVal !== 'false'; // Default to true
    const customCategoryEnabled = customCategoryVal !== 'false'; // Default to true
    
    let baseSystemPrompt = '';
    
    if (useSystemPrompt) {
        try {
            // Get enabled system prompts from database
            const promptRows = db.prepare(`
                SELECT title, content, is_default FROM system_prompts 
                WHERE is_active = 1 
                ORDER BY rank ASC, id ASC
            `).all() as { title: string; content: string; is_default: number }[];
            
            // Filter by category switches
            const filteredRows = promptRows.filter(r => {
                if (r.is_default === 1) {
                    return defaultCategoryEnabled;
                } else {
                    return customCategoryEnabled;
                }
            });
            
            baseSystemPrompt = filteredRows.map(r => {
                // For custom prompts (is_default = 0), include title as a header
                if (r.is_default === 0) {
                    return `[${r.title}]\n${r.content}`;
                }
                // For default prompts, just use content (title is already descriptive in content)
                return r.content;
            }).join('\n\n');
        } catch (e) {
            console.error('Failed to load system prompts', e);
        }
    }

    // Dynamic prompts (from shared module)
    const dynamicPrompts = useSystemPrompt
      ? buildDynamicPromptSectionsForAI(dbService)
      : { stable: '', volatile: '' };
    
    let skillsInfo = '';
    // Load skills info if requested (for prompt context)
    if (options && options.useSkills) {
        try {
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'").get();
            if (tableExists) {
                const skillRows = db.prepare('SELECT name, description FROM skills WHERE enabled = 1 ORDER BY name ASC').all() as {name:string, description:string}[];
                if (skillRows.length > 0) {
                    skillsInfo = '\n\n<available_skills>\n' + 
                        skillRows.map(s => `- "${s.name}": ${s.description}`).join('\n') +
                        '\n</available_skills>';
                }
            }
        } catch (e) {
            console.error('Failed to load skills', e);
        }
    }

    const stableSystemContent = useSystemPrompt
      ? baseSystemPrompt + dynamicPrompts.stable + skillsInfo
      : skillsInfo;
    const systemMessages = [
      ...(stableSystemContent ? [{ role: 'system', content: stableSystemContent }] : []),
      ...(dynamicPrompts.volatile ? [{ role: 'system', content: dynamicPrompts.volatile }] : []),
    ];

    // Current conversation context (will grow with tool calls)
    /**
     * Attachments travel as OpenAI-style content parts. Without this the model
     * only ever saw the text and would answer that no image was provided.
     */
    const toApiMessage = (m: any) => {
        const attachments: string[] = Array.isArray(m.images) ? m.images : [];
        if (attachments.length === 0) return { role: m.role, content: m.content };

        const parts: any[] = [];
        if (m.content) parts.push({ type: 'text', text: m.content });
        for (const file of attachments) {
            const dataUrl = toModelDataUrl(file);
            if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } });
        }
        return parts.length > 0 ? { role: m.role, content: parts } : { role: m.role, content: m.content };
    };

    const currentMessages: any[] = [
        ...systemMessages,
        ...dbMessages.map(toApiMessage)
    ];

    // 3. Prepare Tools (Initial Set)
    // We start with ToolSearch and AttemptCompletion, PLUS any enabled DB tools (Bash, etc.)
    // Note: The logic says "Use ToolSearch to find tools". 
    // BUT we also want common tools (Bash) to be available if enabled.
    // Let's load enabled tools from DB.
    let currentTools: Array<any> = [];

    // Check Global Tool Switch
    const globalToolsEnabledVal = dbService.getSetting('toolBoxGlobalEnabled');
    const globalToolsEnabled = globalToolsEnabledVal !== 'false';

    if (globalToolsEnabled) {
        try {
          const toolRows = db.prepare(`
            SELECT t.name, t.description, t.input_schema
            FROM tools t
            LEFT JOIN tool_categories tc ON t.category_id = tc.id
            WHERE t.enabled = 1 AND (tc.enabled IS NULL OR tc.enabled = 1)
            ORDER BY t.name ASC
          `).all() as any[];
          currentTools = toolRows.map(row => ({
            name: row.name,
            description: row.description || '',
            input_schema: JSON.parse(row.input_schema),
          }));
        } catch (e) {}

        // Ensure ToolSearch and AttemptCompletion are present
        if (!currentTools.find(t => t.name === 'ToolSearch')) currentTools.push(TOOL_SEARCH_DEF);
        if (!currentTools.find(t => t.name === 'AttemptCompletion')) currentTools.push(ATTEMPT_COMPLETION_DEF);
    } // If disabled, currentTools remains [] which means no tools header sent to API

    // MCP servers have their own global switch, so they contribute tools even
    // when the built-in tool box is off.
    try {
        for (const mcpTool of await getMcpService().getEnabledTools()) {
            if (!currentTools.find(t => t.name === mcpTool.name)) currentTools.push(mcpTool);
        }
    } catch (e) {
        console.error('[MCP] Failed to load tools', e);
    }
    currentTools.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);


    let finalResponse = '';
    let finalReasoning = '';
    let turnCount = 0;
    let allowAllOverride = false; // Session-based allow all
    const turnUsages: NormalizedUsage[] = [];
    // Accumulated totals over-report how full the context is once tools trigger
    // extra turns, so keep the last turn on its own for the context indicator.
    let lastTurnContextTokens = 0;

    // Create AbortController for this conversation
    const abortController = new AbortController();
    activeStreamControllers.set(conversationId, abortController);

    // AGENT LOOP
    while (turnCount < MAX_TURNS) {
        turnCount++;
        let toolCallOccurred = false;
        let completionOccurred = false;

        try {
            if (process.env.NODE_ENV !== 'production') {
                printRequestStartSeparator();
            }
            // Check if already aborted
            if (abortController.signal.aborted) {
                break;
            }

            const streamResult = await streamAIAPI(
                provider.type as 'openai-compatible' | 'copilot',
                provider.endpoint || 'https://api.openai.com/v1',
                apiKey,
                modelToUse,
                currentMessages,
                customHeaders,
                provider.auto_cors_fix === 1,
                currentTools,
                (chunkData) => {
                    // Stream to UI. 
                    if (chunkData.content) {
                         finalResponse += chunkData.content;
                    }
                    if (chunkData.reasoning) {
                         finalReasoning += chunkData.reasoning;
                    }
                    _event.sender.send('chat:chunk', { conversationId, ...chunkData });
                },
                async (toolCall) => {
                    toolCallOccurred = true;
                    if (process.env.NODE_ENV !== 'production') {
                        printRespondStartSeparator();
                        console.log('>>> TOOL CALL RECEIVED:', JSON.stringify(toolCall, null, 2));
                        printRespondEndSeparator();
                    }

                    // Append Assistant Message with Tool Call
                    currentMessages.push({
                        role: 'assistant',
                        content: '', // Content likely streamed already, but for tool call msg structure we need tool_calls
                        tool_calls: [{
                            id: toolCall.id,
                            type: 'function',
                            function: {
                                name: toolCall.name,
                                arguments: JSON.stringify(toolCall.input)
                            }
                        }]
                    } as any);

                    // HANDLE TOOL EXECUTION
                    let resultStr = '';

                    const definition = currentTools.find(tool => tool.name === toolCall.name);
                    const storedDefaults = db.prepare(
                        'SELECT default_input FROM tools WHERE name = ?'
                    ).get(toolCall.name) as { default_input: string | null } | undefined;
                    const preparedInput = prepareToolInput({
                        schema: definition?.input_schema || { type: 'object' },
                        defaultInput: parseStoredJsonObject(storedDefaults?.default_input),
                        input: toolCall.input,
                    });
                    const toolInput: JsonObject = preparedInput.kind === 'valid' ? preparedInput.input : {};

                    if (preparedInput.kind === 'invalid') {
                        resultStr = `Invalid arguments for ${toolCall.name}: ${preparedInput.error}`;
                    } else if (toolCall.name === 'AttemptCompletion') {
                        completionOccurred = true;
                        resultStr = typeof toolInput.result === 'string' ? toolInput.result : 'Task completed.';
                        if (process.env.NODE_ENV !== 'production') console.log('>>> COMPLETION ATTEMPTED:', resultStr);
                        
                        // Send as chunk so it appears in UI
                        _event.sender.send('chat:chunk', { conversationId, content: resultStr });
                        finalResponse += resultStr;
                        
                    } else if (toolCall.name === 'ToolSearch') {
                        // Execute Tool Search
                        const searchQuery = typeof toolInput.query === 'string' ? toolInput.query : '';
                        _event.sender.send('chat:chunk', { conversationId, content: `\n\n> 🔍 Searching tools for: "${searchQuery}"...\n` });
                        if (process.env.NODE_ENV !== 'production') console.log(`>>> Executing ToolSearch: ${searchQuery}`);
                        const foundTools = await callToolsModel(searchQuery, dbService);
                        if (process.env.NODE_ENV !== 'production') console.log('>>> ToolSearch Results:', JSON.stringify(foundTools, null, 2));
                        
                        // Add found tools to currentTools if not exists
                        let newCount = 0;
                        for (const ft of foundTools) {
                             if (!currentTools.find(t => t.name === ft.name)) {
                                 currentTools.push({
                                     name: ft.name,
                                     description: ft.description,
                                     input_schema: ft.inputSchema || {} // Simplify
                                 });
                                 newCount++;
                             }
                        }
                        
                        // Respond to LLM
                        const foundNames = foundTools.map(t => t.name).join(', ');
                        resultStr = JSON.stringify({
                            query: searchQuery,
                            found: foundTools.length,
                            tools: foundTools,
                            reasoning: `Found ${foundTools.length} tools. Added to available tools: ${foundNames}`
                        });
                        
                    } else if (!hasToolExecutor(toolCall.name)) {
                        resultStr = `Tool "${toolCall.name}" has a definition but no executor. Add a matching MCP tool or implement a built-in executor before enabling this definition.`;
                    } else {
                        // Executable tools use a tool-aware approval policy.
                        
                        // 1. Analyze Safety
                        if (process.env.NODE_ENV !== 'production') console.log(`>>> Analyzing tool safety for ${toolCall.name}...`);
                        const analysis = toolCall.name === 'Bash'
                          ? await analyzeCommand(
                            typeof toolInput.command === 'string' ? toolInput.command : '',
                            {
                                type: provider.type,
                                endpoint: provider.endpoint || 'https://api.openai.com/v1',
                                apiKey,
                                model: modelToUse,
                            }
                          )
                          : analyzeNonShellTool(toolCall.name, toolInput);
                        if (process.env.NODE_ENV !== 'production') console.log('>>> Safety Analysis:', JSON.stringify(analysis, null, 2));

                        // Quick override check
                        // If tool is explicitly safe (needsPermission=false) OR allowAllOverride is true
                        const isSafe = analysis.needsPermission === false;
                        const isSkill = toolCall.name.toLowerCase().includes('skill');
                        

                        if (allowAllOverride || isSafe) {
                             if (process.env.NODE_ENV !== 'production') console.log('>>> Auto-approving tool execution');
                             // Execute immediately
                             const res = await invokeToolExecution(toolCall.name, toolInput);
                             
                             let displayResult = res.result || res.error || 'Done';
                             // For Bash, prepend the command so it shows in the console window
                             if (toolCall.name === 'Bash') {
                                 displayResult = `> ${String(toolInput.command || '')}\n\n${displayResult}`;
                             }

                             // Send result to UI for display (Console Output) -- Skip for Skills
                             if (!isSkill) {
                                 _event.sender.send('chat:tool-result', { 
                                     conversationId, 
                                     toolName: toolCall.name, 
                                     result: displayResult,
                                     createdAt: Date.now(),
                                 });
                             }
                             resultStr = res.result || res.error || 'Done';
                        } else {
                            // Ask User
                            if (process.env.NODE_ENV !== 'production') console.log('>>> Waiting for user approval...');
                            const approvalPromise = new Promise<{ approved: boolean; approvedAll: boolean }>((resolve) => {
                                pendingToolApprovals.set(toolCall.id, resolve);
                            });
                            
                            // Resolve Skill Path for UI
                            let skillPath = undefined;
                            if (isSkill) {
                                try {
                                    const db = dbService.getDb();
                                    const path = require('path');
                                    const os = require('os');
                                    
                                    const skillNameInput = toolInput.skill || toolInput.name;
                                    if (skillNameInput) {
                                         const allSkills = db.prepare('SELECT * FROM skills').all() as any[];
                                         const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                                         const target = normalize(String(skillNameInput));
                                         const skill = allSkills.find(s => normalize(s.name) === target || normalize(s.skill_folder) === target);
                                         
                                         if (skill) {
                                             const dir = db.prepare('SELECT path FROM skill_directories WHERE id = ?').get(skill.skill_directory_id) as any;
                                             if (dir) {
                                                 const expandPath = expandHome;
                                                 const fullPath = path.join(expandPath(dir.path), skill.skill_folder);
                                                 skillPath = path.join(fullPath, 'SKILL.md');
                                             }
                                         }
                                    }
                                } catch (e) {
                                    console.error('Failed to resolve skill path', e);
                                }
                            }

                            // Send to UI
                            _event.sender.send('chat:tool-call', { 
                                conversationId, 
                                ...toolCall,
                                input: toolInput,
                                analysis,
                                skillPath,
                                createdAt: Date.now(),
                            });
                            
                            // Wait for UI
                            const approval = await approvalPromise;
                            if (process.env.NODE_ENV !== 'production') console.log('>>> User approval result:', approval);
                            
                            if (approval.approved) {
                                if (approval.approvedAll) allowAllOverride = true;
                                const res = await invokeToolExecution(toolCall.name, toolInput);
                                
                                let displayResult = res.result || res.error || 'Done';
                                if (toolCall.name === 'Bash') {
                                    displayResult = `> ${String(toolInput.command || '')}\n\n${displayResult}`;
                                }
                                
                                resultStr = res.result || res.error || 'Done'; // Keep raw result for context

                                // Send result to UI for display (Console Output) -- Skip for Skills
                                if (!isSkill) {
                                    _event.sender.send('chat:tool-result', { 
                                        conversationId, 
                                        toolName: toolCall.name,
                                        result: displayResult,
                                        createdAt: Date.now(),
                                    });
                                }
                            } else {
                                resultStr = "User denied permission to execute this tool.";
                            }
                        }
                    }



                    if (process.env.NODE_ENV !== 'production') {
                        printRespondStartSeparator();
                        console.log('>>> Tool Execution Result:', resultStr);
                        printRespondEndSeparator();
                    }

                    // Append Tool Result
                    if (modelToUse.toLowerCase().includes('claude') && provider.type !== 'copilot') {
                         // Copilot/OpenAI proxies often reject 'tool_result' content type (400 Bad Request).
                         // We format it as a User Message but with specific content structure that they might expect if they support tool_use blocks.
                         // Per user request, we use the standard structure:
                         currentMessages.push({
                            role: 'user',
                            content: [
                                {
                                    type: 'tool_result',
                                    tool_use_id: toolCall.id,
                                    content: resultStr
                                }
                            ]
                         });
                    } else {
                         currentMessages.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: resultStr
                        });
                    }
                    
                    // Emphasize result in UI if needed - REMOVED per user request (handled by tool-result event or LLM summary)
                    // if (toolCall.name !== 'ToolSearch' && toolCall.name !== 'AttemptCompletion') {
                    //      _event.sender.send('chat:chunk', { conversationId, content: `\n\n\`\`\`\n${resultStr.slice(0, 500)}${resultStr.length > 500 ? '...' : ''}\n\`\`\`\n` });
                    // }
                },
                abortController.signal
            );

            // Accumulate token usage from this turn
            turnUsages.push(streamResult.usage);
            lastTurnContextTokens = streamResult.usage.promptTokens + streamResult.usage.completionTokens;

            if (!toolCallOccurred) {
                // LLM finished without calling a tool. 
                // This means it's done or asking a question.
                // We treat this as completion of the turn.
                break;
            }
            
            if (completionOccurred) {
                break;
            }

        } catch (err: any) {
            if (err.message === 'DISPLAY_ONLY_ERROR') {
                 // Friendly error was already streamed to UI.
                 // We return success here so the UI finishes loading state.
                 // We do NOT save this to DB (by returning early before chatService.addMessage).
                 activeStreamControllers.delete(conversationId);
                 return { response: finalResponse };
            }
            if (err.name === 'AbortError' || abortController.signal.aborted) {
                 // Stream was stopped by user
                 activeStreamControllers.delete(conversationId);
                 if (finalResponse) {
                     const usage = aggregateCacheUsage(turnUsages);
                     const tokenData = {
                         providerId,
                         modelId: modelToUse,
                         promptTokens: usage.promptTokens,
                         completionTokens: usage.completionTokens,
                         reasoningTokens: usage.reasoningTokens,
                         cachedTokens: usage.cachedTokens,
                         cacheStatus: usage.cacheStatus,
                         totalTokens: usage.totalTokens,
                         contextTokens: lastTurnContextTokens,
                     };
                     const assistantMessage = chatService.addMessage(conversationId, 'assistant', finalResponse, tokenData, undefined, finalReasoning);
                     chatService.updateConversationTokens(conversationId, providerId, modelToUse, tokenData);
                     _event.sender.send('chat:stream-complete', {
                         conversationId,
                         tokenData,
                         message: { id: assistantMessage.id, createdAt: assistantMessage.createdAt },
                     });
                 }
                 return { response: finalResponse };
            }
            console.error('Agent loop error', err);
            activeStreamControllers.delete(conversationId);
            return { response: finalResponse, error: (err as Error).message };
        }
    }

    // Clean up AbortController
    activeStreamControllers.delete(conversationId);

    // Save final response (accumulated) to DB with token data
    const usage = aggregateCacheUsage(turnUsages);
    const tokenData = {
        providerId,
        modelId: modelToUse,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedTokens: usage.cachedTokens,
        cacheStatus: usage.cacheStatus,
        totalTokens: usage.totalTokens,
        contextTokens: lastTurnContextTokens,
    };
    const assistantMessage = chatService.addMessage(conversationId, 'assistant', finalResponse, tokenData, undefined, finalReasoning);

    // Update conversation tokens JSON
    chatService.updateConversationTokens(conversationId, providerId, modelToUse, tokenData);

    // Notify renderer of stream completion with token data
    _event.sender.send('chat:stream-complete', {
        conversationId,
        tokenData,
        message: { id: assistantMessage.id, createdAt: assistantMessage.createdAt },
    });
    
    return { response: finalResponse };
}

// Helper: Call Tools AI Model
async function callToolsModel(query: string, dbService: any): Promise<any[]> {
    try {
        const toolModelSetting = dbService.getSetting('toolModel'); // e.g. "providerId:modelId" or just "modelId"
        if (!toolModelSetting) return []; // Fallback?

        // Parse setting
        const db = dbService.getDb();
        let providerId = ''; 
        let model = '';
        
        if (toolModelSetting.includes(':')) {
            const parts = toolModelSetting.split(':');
            providerId = parts[0];
            model = parts.slice(1).join(':');
        } else {
             // Fallback: search for provider with this model
             const p = db.prepare('SELECT id FROM ai_providers WHERE model = ?').get(toolModelSetting) as any;
             if (p) { providerId = p.id; model = toolModelSetting; }
             // Else use default provider
             else {
                 const def = db.prepare('SELECT id, model FROM ai_providers WHERE is_default = 1').get() as any;
                 if (def) { providerId = def.id; model = def.model; } // Use default as fallback
             }
        }
        
        const provider = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(providerId) as any;
        if (!provider) return [];
        
        const crypto = getCrypto();
        let apiKey: string | null = null;
        if (provider.api_key_encrypted && crypto.isUnlocked()) {
             try { apiKey = crypto.decrypt(provider.api_key_encrypted); } catch {}
        }
        

        const toolSearchPrompt = buildToolSearchPrompt(db);

        const messages = [
            { role: 'system', content: toolSearchPrompt },
            { role: 'user', content: `Search query: "${query}"\n\nFind all tools that match this query and return as JSON.` }
        ];

        const searchResult = await callNonStreamingChatCompletion(
            {
                type: provider.type,
                endpoint: provider.endpoint || 'https://api.openai.com/v1',
                apiKey,
                model,
                autoCORSFix: provider.auto_cors_fix === 1
            },
            messages,
            { temperature: 0, maxTokens: 2000, label: 'TOOL SEARCH' }
        );
        const jsonStr = searchResult.content || '';
        
        // Parse JSON from text
        const match = jsonStr.match(/```json\n([\s\S]*?)\n```/) || jsonStr.match(/{[\s\S]*}/);
        const cleanJson = match ? match[1] || match[0] : jsonStr;
        const result = JSON.parse(cleanJson);
        
        // Map Result codes to actual tool definitions
        // The prompt asks for "tools": ["Bash", ...]
        // We need to look up these IDs in our hardcoded known tools or DB.
        // For now, we return valid tool objects.
        const foundTools: any[] = [];
        
        // Define known built-in tool templates (simplified)
        const builtIns: Record<string, any> = {
            'Bash': { name: 'Bash', description: 'Run shell commands', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
            'BashOutput': { name: 'BashOutput', description: 'Get shell output', inputSchema: { type: 'object', properties: { bash_id: { type: 'string' } }, required: ['bash_id'] } },
            'KillShell': { name: 'KillShell', description: 'Kill shell', inputSchema: { type: 'object', properties: { shell_id: { type: 'string' } }, required: ['shell_id'] } }
            // Add other built-ins as needed or load from DB if they are there
        };
        
        if (result.tools && Array.isArray(result.tools)) {
            for (const tId of result.tools) {
                if (builtIns[tId]) foundTools.push(builtIns[tId]);
                // If it's in DB, we already have it in currentTools? 
                // Checks DB again? 
                // The main loop loaded enabled tools from DB.
                // ToolSearch might find *disabled* tools? 
                // Or tools not yet loaded. 
            }
        }
        return foundTools;

    } catch (e) {
        console.error('Tools Model call failed', e);
        return [];
    }
}

/**
 * Attachment paths belonging to a conversation that no other conversation
 * references. Paths are unique per upload, so in practice this is all of them;
 * the check only guards against a message ever being copied elsewhere.
 */
function collectRemovableImages(conversationId: string): string[] {
    const chatService = getChatService();
    const own = new Set<string>();
    for (const message of chatService.getMessages(conversationId)) {
        for (const file of message.images || []) own.add(file);
    }
    if (own.size === 0) return [];

    // Compare parsed values rather than matching the JSON text: a Windows path
    // is stored with escaped backslashes, so a LIKE on the raw column would
    // never match and every attachment would be treated as still in use.
    let usedElsewhere: Set<string>;
    try {
        const rows = getDatabase().getDb().prepare(
            'SELECT images FROM messages WHERE conversation_id != ? AND images IS NOT NULL'
        ).all(conversationId) as Array<{ images: string }>;

        usedElsewhere = new Set<string>();
        for (const row of rows) {
            try {
                for (const file of JSON.parse(row.images) || []) {
                    usedElsewhere.add(normalizeForCompare(file));
                }
            } catch {
                /* skip a malformed row */
            }
        }
    } catch (e) {
        console.error('[Chat] Could not check attachment reuse; keeping files', e);
        return [];
    }

    return [...own].filter(file => !usedElsewhere.has(normalizeForCompare(file)));
}

async function invokeToolExecution(toolName: string, toolInput: JsonObject): Promise<{ success: boolean; result?: string; error?: string }> {
      try {
      // MCP tools are namespaced (mcp__<server>__<tool>) and routed to their server
      if (getMcpService().isMcpTool(toolName)) {
        return await getMcpService().callTool(toolName, toolInput);
      }

      if (toolName === 'Bash') {
        const { exec } = require('child_process');
        const workspacePath = workspaceDir();
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        
        return new Promise((resolve) => {
          exec(command, { cwd: workspacePath, timeout: 60000 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
              resolve({ success: false, error: error.message, result: stderr });
            } else {
              resolve({ success: true, result: stdout || stderr || 'Command executed successfully' });
            }
          });
        });
      }

      if (toolName === 'WebSearch') {
        const db = getDatabase();
        const provider = db.getSetting('search_provider') || 'duckduckgo';
        
        const query = typeof toolInput.query === 'string' ? toolInput.query.trim() : '';
        if (!query) return { success: false, error: 'Query is required for WebSearch' };
        const maxResults = typeof toolInput.max_results === 'number' ? toolInput.max_results : undefined;
        const allowedDomains = Array.isArray(toolInput.allowed_domains)
          ? toolInput.allowed_domains.filter((domain): domain is string => typeof domain === 'string')
          : undefined;
        const blockedDomains = Array.isArray(toolInput.blocked_domains)
          ? toolInput.blocked_domains.filter((domain): domain is string => typeof domain === 'string')
          : undefined;
        
        try {
            const results = await performSearch(query, provider, {
              maxResults,
              allowedDomains,
              blockedDomains,
            });
            // Format results
            const formatted = results.map((result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.content}`).join('\n\n');
            const body = formatted || 'No results matched the query and domain filters.';
            return { success: true, result: `Web Search Results for "${query}" (via ${provider}):\n\n${body}` };
        } catch (error) {
             const message = error instanceof Error ? error.message : String(error);
             return { success: false, error: `WebSearch failed: ${message}` };
        }
      }

      if (toolName === 'WebFetch') {
        const { performWebFetch } = require('./utils/BrowserUtils');
        const url = typeof toolInput.url === 'string' ? toolInput.url : '';
        if (!url) return { success: false, error: 'URL is required for WebFetch' };
        
        try {
            // Check if URL is valid
            new URL(url); 
            const content = await performWebFetch(url);
            return { success: true, result: content };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: `WebFetch failed: ${message}` };
        }
      }

      if (toolName.toLowerCase() === 'skill' || toolName.toLowerCase() === 'executeskill') {
          const db = getDatabase().getDb();
          const path = require('path');
          const fs = require('fs');
          const os = require('os');
          
          const skillNameInput = toolInput.skill || toolInput.name;
          if (!skillNameInput) return { success: false, error: 'Skill name required' };

          const allSkills = db.prepare('SELECT * FROM skills').all() as any[];
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const target = normalize(String(skillNameInput));
          const skill = allSkills.find(s => normalize(s.name) === target || normalize(s.skill_folder) === target);
          
          if (!skill) return { success: false, error: `Skill not found: ${skillNameInput}` };
          
          const dir = db.prepare('SELECT path FROM skill_directories WHERE id = ?').get(skill.skill_directory_id) as any;
          if (!dir) return { success: false, error: 'Skill directory error' };
          
          const expandPath = expandHome;
          const fullPath = path.join(expandPath(dir.path), skill.skill_folder);
          const skillMdPath = path.join(fullPath, 'SKILL.md');
          
          if (fs.existsSync(skillMdPath)) {
               const content = fs.readFileSync(skillMdPath, 'utf-8');
               const resultMsg = `Skill Documentation for "${skill.name}":\n\n${content}`;
               return { success: true, result: resultMsg };
          } else {
               return { success: false, error: 'SKILL.md not found' };
          }
      }
      
      return { success: false, error: `Unknown tool: ${toolName}` };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
}

/**
 * Generate a conversation title from the first user message using the current AI model.
 * Runs asynchronously without blocking the main response stream.
 */
async function generateConversationTitle(
  userMessage: string,
  provider: any,
  apiKey: string | null,
  model: string,
  customHeaders: Record<string, string>,
  conversationId: string,
  chatService: ReturnType<typeof getChatService>,
  sender: any
): Promise<void> {
  const TITLE_SYSTEM_PROMPT = 'You are a conversation title generator. Based on the user\'s message, create a brief, descriptive title (2-6 words). Respond with ONLY the title text. No quotes, no explanation, no extra punctuation.';

  const messages = [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    { role: 'user', content: userMessage.slice(0, 500) }
  ];

  // Helper: save fallback title
  const saveFallback = () => {
    const fallback = userMessage.split(/\s+/).slice(0, 5).join(' ');
    const fallbackTitle = fallback.length > 30 ? fallback.slice(0, 30) + '...' : fallback;
    chatService.updateTitle(conversationId, fallbackTitle);
    sender.send('chat:title-updated', { conversationId, title: fallbackTitle });
  };

  try {
    const result = await callNonStreamingChatCompletion(
      {
        type: provider.type,
        endpoint: provider.endpoint || 'https://api.openai.com/v1',
        apiKey,
        model,
        autoCORSFix: provider.auto_cors_fix === 1,
        customHeaders
      },
      messages,
      { temperature: 0.3, maxTokens: 30, label: 'TITLE GENERATION' }
    );

    if (!result.content) {
      saveFallback();
      return;
    }

    let title = result.content;

    // Clean up: remove surrounding quotes if present
    title = title.replace(/^["']+|["']+$/g, '').trim();
    // Limit length
    if (title.length > 60) {
      title = title.slice(0, 57) + '...';
    }

    chatService.updateTitle(conversationId, title);
    sender.send('chat:title-updated', { conversationId, title });

    // Extract token data from title generation
    const titleUsage = normalizeOpenAIUsage(result.usage);
    const titleTokenData = {
      providerId: provider.id,
      modelId: model,
      promptTokens: titleUsage.promptTokens,
      completionTokens: titleUsage.completionTokens,
      reasoningTokens: titleUsage.reasoningTokens,
      cachedTokens: titleUsage.cachedTokens,
      cacheStatus: titleUsage.cacheStatus,
      totalTokens: titleUsage.totalTokens,
    };

    // Account for the title request without inserting synthetic content into
    // conversation history, which must remain append-only for prompt caching.
    chatService.updateTitleTokens(conversationId, titleUsage.totalTokens);
    chatService.updateConversationTokens(conversationId, provider.id, model, titleTokenData);
    sender.send('chat:title-usage', {
      conversationId,
      titleTokens: titleUsage.totalTokens,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Title Generated] "${title}" for conversation ${conversationId}`);
    }
  } catch (e) {
    console.error('Title generation error:', e);
    saveFallback();
  }
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Per-stream state for models that inline their reasoning in `content`
 * as <think>...</think> instead of using a separate delta field.
 */
interface ThinkTagState {
    inThink: boolean;
    pending: string;
}

/**
 * Longest suffix of `buf` that could still grow into `tag`, so a tag split
 * across two chunks is not emitted as visible content.
 */
function partialTagLength(buf: string, tag: string): number {
    const max = Math.min(buf.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
        if (tag.startsWith(buf.slice(buf.length - len))) return len;
    }
    return 0;
}

/**
 * Split a content delta into visible content and inlined reasoning.
 * Carries state across chunks, so tags may straddle chunk boundaries.
 */
function splitThinkTags(chunk: string, state: ThinkTagState): { content: string; reasoning: string } {
    let buf = state.pending + chunk;
    state.pending = '';
    let content = '';
    let reasoning = '';

    while (buf) {
        const tag = state.inThink ? THINK_CLOSE : THINK_OPEN;
        const idx = buf.indexOf(tag);

        if (idx !== -1) {
            const before = buf.slice(0, idx);
            if (state.inThink) reasoning += before; else content += before;
            state.inThink = !state.inThink;
            buf = buf.slice(idx + tag.length);
            continue;
        }

        // No complete tag: emit everything except a possible partial tag tail
        const keep = partialTagLength(buf, tag);
        const emit = buf.slice(0, buf.length - keep);
        if (state.inThink) reasoning += emit; else content += emit;
        state.pending = buf.slice(buf.length - keep);
        break;
    }

    return { content, reasoning };
}

function processLine(
    line: string, 
     onChunk: (data: { content?: string; reasoning?: string }) => void,
     toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }>,
     logAccumulator?: LogAccumulator,
     thinkState?: ThinkTagState
) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") return;
    
    if (trimmed.startsWith("data: ")) {
        const jsonStr = trimmed.substring(6);
        try {
            const data = JSON.parse(jsonStr);

            const delta = data.choices?.[0]?.delta;
            
            if (delta) {
                // Providers disagree on the field name: `reasoning` (OpenRouter),
                // `reasoning_content` (DeepSeek/llama.cpp/vLLM/Qwen/GLM), or the
                // reasoning inlined in `content` as <think>...</think>.
                const deltaReasoning = delta.reasoning ?? delta.reasoning_content ?? '';
                const split = thinkState
                    ? splitThinkTags(delta.content || '', thinkState)
                    : { content: delta.content || '', reasoning: '' };

                const content = split.content;
                const reasoning = deltaReasoning + split.reasoning;

                if (content || reasoning) {
                   onChunk({ content: content || undefined, reasoning: reasoning || undefined });
                }
                
                // Accumulate tool call parts
                if (delta.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                        const index = toolCall.index;
                        if (!toolCallAccumulator[index]) {
                            toolCallAccumulator[index] = { 
                                id: toolCall.id || '', 
                                name: toolCall.function?.name || '', 
                                arguments: '' 
                            };
                        }
                        
                        if (toolCall.id) toolCallAccumulator[index].id = toolCall.id;
                        if (toolCall.function?.name) toolCallAccumulator[index].name = toolCall.function.name;
                        if (toolCall.function?.arguments) toolCallAccumulator[index].arguments += toolCall.function.arguments;
                    }
                }
            }
            
            
            // Populate Log Accumulator
            if (logAccumulator) {
                 updateLogAccumulator(logAccumulator, data, toolCallAccumulator, thinkState);
            }
        } catch (e) {
            console.warn("Failed to parse SSE line", trimmed, e);
        }
    } else {
        // Handle non-SSE JSON errors
        try {
            const data = JSON.parse(trimmed);
            if (data.error) {
                onChunk({ content: `[Error: ${data.error.message || JSON.stringify(data.error)}]` });
            }
        } catch (ignore) {}
    }
}

/**
 * Updates the log accumulator with new chunk data
 */
function updateLogAccumulator(
    acc: LogAccumulator, 
    data: any, 
    toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }>,
    thinkState?: ThinkTagState
) {
     if (!acc.id && data.id) acc.id = data.id;
     if (!acc.model && data.model) acc.model = data.model;
     if (!acc.created && data.created) acc.created = data.created;
     if (data.usage && Object.keys(data.usage).length > 0) acc.usage = data.usage;
     
     const choice = data.choices?.[0];
     if (choice) {
         if (choice.delta?.role && !acc.role) acc.role = choice.delta.role;
         // processLine already stripped inline <think> from the content it emitted;
         // the log keeps the raw split so both halves stay readable.
         const reasoning = choice.delta?.reasoning ?? choice.delta?.reasoning_content;
         if (reasoning) acc.reasoningParts.push(reasoning);
         if (choice.delta?.content && !thinkState?.inThink) acc.contentParts.push(choice.delta.content);
     }
     
     // Update tool calls reference (always points to latest state of accumulator)
     acc.toolCalls = Object.values(toolCallAccumulator);
}

/**
 * Prints the accumulated log to stdout in a clean format
 */
function printLogAccumulator(acc: LogAccumulator) {
    if (process.env.NODE_ENV === 'production') return;

    const consolidated = {
         ...acc,
         content: acc.contentParts.join(''),
         reasoning: acc.reasoningParts.join(''),
         // Cleanup parts for cleaner print if we were JSON.stringifying the whole object, 
         // but here we manually print fields, so it's fine.
    };

    process.stdout.write('\n--- STREAM COMPLETE ---\n');
    process.stdout.write('Metadata: ' + JSON.stringify({ 
        id: consolidated.id, 
        model: consolidated.model, 
        created: consolidated.created,
        role: consolidated.role,
        usage: consolidated.usage
    }) + '\n');
    
    if (consolidated.content) {
        process.stdout.write('Content: ' + consolidated.content + '\n');
    }
    if (consolidated.reasoning) {
         process.stdout.write('Reasoning: ' + consolidated.reasoning + '\n');
    }
    if (consolidated.toolCalls && consolidated.toolCalls.length > 0) {
         process.stdout.write('ToolCalls: ' + JSON.stringify(consolidated.toolCalls, null, 2) + '\n');
    }
    printVisualSeparator('=*');
}
