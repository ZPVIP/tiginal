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

const TOOL_SEARCH_PROMPT = `You are a tool search assistant. Your task is to find tools that match the user's search query.

Available tools:
Built-in tools:
- Task: [builtin] Launch sub-agents for complex multi-step tasks
- Bash: [builtin] Run shell commands
- Glob: [builtin] Find files matching glob patterns
- Grep: [builtin] Search file contents with ripgrep
- Read: [builtin] Read file contents
- Edit: [builtin] Modify files
- Write: [builtin] Create or overwrite files
- WebFetch: [builtin] Fetch URL contents
- WebSearch: [builtin] Search the web
- TodoWrite: [builtin] Manage TODO lists
- BashOutput: [builtin] Get output from running shell commands
- KillShell: [builtin] Terminate running shell commands
- Skill: [builtin] Invoke saved skills or workflows
- AttemptCompletion: [builtin] Signal completion

Based on the search query, select all tools that are relevant. Return your response as a JSON object with:
- "tools": an array of tool IDs that match the search query
- "reasoning": a brief explanation of why these tools were selected

Guidelines:
1. Select tools that semantically match what the user is looking for
2. If the query is broad, include multiple relevant tools
3. If no tools match, return an empty array
`;

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
  // Submit tool approval (User clicked Allow/Deny)
  ipcMain.handle('chat:submit-tool-approval', async (_event, { toolCallId, approved, approvedAll }: { toolCallId: string; approved: boolean; approvedAll: boolean }): Promise<void> => {
      const resolver = pendingToolApprovals.get(toolCallId);
      if (resolver) {
          resolver({ approved, approvedAll });
          pendingToolApprovals.delete(toolCallId);
      }
  });

  // Send message to AI (Autonomous Agent Loop)
  ipcMain.handle('chat:send-message', async (_event, conversationId: string, providerId: string, content: string, specificModel?: string, options: { useSystemPrompt?: boolean, useSkills?: boolean } = {}): Promise<{ response: string; error?: string }> => {
    return runAgentLoop(_event, conversationId, providerId, content, specificModel, options);
  });

  // Execute a tool (called after user approves)
  ipcMain.handle('chat:execute-tool', async (_event, toolName: string, toolInput: any): Promise<{ success: boolean; result?: string; error?: string }> => {
    try {
      if (toolName === 'Bash') {
        // Execute bash command
        const { exec } = require('child_process');
        const workspacePath = getDatabase().getSetting('workspacePath') || 
          require('path').join(require('os').homedir(), '.config', 'tiginal', 'workspaces');
        
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
          const expandPath = (p: string) => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
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
): Promise<{ needsPermission: boolean; description: string; riskLevel: string }> {
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
        // We use fetch inside electron main process (Node 18+ has fetch)
        // If not available, we can require it or use axios if installed, but let's assume global fetch or require('node-fetch').
        // Electron usually has fetch in main process for recent versions.
        
        const messages = [
            { role: 'system', content: prompt },
            { role: 'user', content: `Analyze this bash command: ${command}` }
        ];

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        
        let endpoint = apiConfig.endpoint;

        if (apiConfig.type === 'copilot' && apiConfig.apiKey) {
             if (!endpoint || endpoint.includes('api.openai.com')) {
                 endpoint = 'https://api.githubcopilot.com'; 
             }
             const copilotToken = await getCopilotToken(apiConfig.apiKey);
             headers['Authorization'] = `Bearer ${copilotToken}`;
             headers['Copilot-Integration-Id'] = 'vscode-chat';
             headers['Editor-Version'] = 'vscode/1.107.0'; 
             headers['Editor-Plugin-Version'] = 'copilot-chat/0.35.0';
             headers['User-Agent'] = 'GitHubCopilotChat/0.35.0';
             headers['Openai-Intent'] = 'conversation-edits';
        } else if (apiConfig.apiKey) {
            headers['Authorization'] = `Bearer ${apiConfig.apiKey}`;
        }
        
        try { const url = new URL(endpoint); headers['Origin'] = url.origin; } catch(e){}

        const body = JSON.stringify({
            model: apiConfig.model,
            messages,
            temperature: 0.1, 
            max_tokens: 1000,
            stream: false
        });

        printRequestStartSeparator();
        if (process.env.NODE_ENV !== 'production') {
             process.stdout.write('\n--- ANALYZE COMMAND REQUEST ---\n');
             process.stdout.write('URL: ' + `${endpoint}/chat/completions` + '\n');
             const safeHeaders = { ...headers };
             if (safeHeaders['Authorization']) safeHeaders['Authorization'] = 'Bearer [HIDDEN]';
             process.stdout.write('Headers: ' + JSON.stringify(safeHeaders, null, 2) + '\n');
             process.stdout.write('Body: ' + JSON.stringify(JSON.parse(body), null, 2) + '\n');
        }

        const response = await fetchWithLocalhostFallback(`${endpoint}/chat/completions`, {
            method: 'POST',
            headers,
            body
        });

        printRequestEndSeparator();

        if (!response.ok) {
            console.error(`Analyzer API failed: ${response.status} - ${await response.text()}`);
            return { needsPermission: true, description: `Execute: ${command}`, riskLevel: 'medium' };
        }

        const data = await response.json() as any;
        
        if (process.env.NODE_ENV !== 'production') {
             printRespondStartSeparator();
             process.stdout.write('\n--- ANALYZE COMMAND RESPONSE ---\n');
             process.stdout.write('Status: ' + response.status + '\n');
             process.stdout.write('Body: ' + JSON.stringify(data, null, 2) + '\n');
             printRespondEndSeparator();
        }

        const content = data.choices?.[0]?.message?.content;
        
        if (content) {
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/{[\s\S]*}/);
            const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
            try {
                const result = JSON.parse(jsonStr);
                return {
                    needsPermission: result.needsPermission,
                    description: result.description || `Execute: ${command}`,
                    riskLevel: result.riskLevel || 'medium'
                };
            } catch (e) {
                console.warn('Failed to parse analyzer response', content);
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
  messages: Array<{ role: string; content: string }>,
  customHeaders: Record<string, string> = {},
  autoCORSFix: boolean = true,
  tools: Array<{ name: string; description: string; input_schema: object }> = [],
  onChunk: (data: { content?: string; reasoning?: string }) => void,
  onToolCall?: (data: { id: string; name: string; input: any }) => void | Promise<void>
): Promise<void> {
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

  const bodyPayload: any = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 4000,
    stream: true
  };

  if (tools.length > 0) {
    bodyPayload.tools = tools.map(t => ({
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
      process.stdout.write('-----------------------------\n\n');
  }


  let response;
  try {
    response = await fetchWithLocalhostFallback(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
    });
  } catch (error: any) {
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
    const errorText = await response.text();
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
                 return;
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
    return;
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

  try {
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";  

        for (const line of lines) {
           processLine(line, onChunk, toolCallAccumulator, logAccumulator);
        }
    }
    
    // Process remaining buffer
    if (buffer.trim()) {
        processLine(buffer, onChunk, toolCallAccumulator, logAccumulator);
    }

    // Finalize any pending tool calls after stream ends
    if (onToolCall) {
        const toolsToCall = Object.values(toolCallAccumulator);
        for (const tool of toolsToCall) {
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
}

async function runAgentLoop(_event: any, conversationId: string, providerId: string, content: string, specificModel?: string, options: { useSystemPrompt?: boolean, useSkills?: boolean } = {}): Promise<{ response: string; error?: string }> {
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
    chatService.addMessage(conversationId, 'user', content);
    const dbMessages = chatService.getMessages(conversationId);
    
    // Construct System Prompt
    const useSystemPrompt = options?.useSystemPrompt !== false;
    const baseSystemPrompt = useSystemPrompt ? (dbService.getSetting('systemPrompt') || '') : '';
    
    const dateStr = new Date().toLocaleDateString('en-CA');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateInfo = `\n\nIMPORTANT - Today's date is ${dateStr} (timezone: ${timezone}).`;
    
    let workspacePath = dbService.getSetting('workspacePath');
    if (!workspacePath) {
        const os = require('os');
        const path = require('path');
        workspacePath = process.platform === 'win32' 
            ? path.join(process.env.APPDATA || os.homedir(), 'Tiginal', 'workspaces')
            : path.join(os.homedir(), '.config', 'tiginal', 'workspaces');
    }
    const wdInfo = `\n\nWORKING DIRECTORY - Your current working directory is: ${workspacePath}.`;
    
    let skillsInfo = '';
    // Load skills info if requested (for prompt context)
    if (options && options.useSkills) {
        try {
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'").get();
            if (tableExists) {
                const skillRows = db.prepare('SELECT name, description FROM skills WHERE enabled = 1').all() as {name:string, description:string}[];
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

    const systemMessage = { 
        role: 'system', 
        content: useSystemPrompt 
           ? baseSystemPrompt + dateInfo + wdInfo + skillsInfo 
           : '' + skillsInfo  // Keep skills info if enabled via separate switch, or should it also be hidden? 
                              // User complaint specifically cited date/wd info. Skills are separate toggle usually.
                              // Let's assume options.useSkills controls skillsInfo separately.
    };

    // Current conversation context (will grow with tool calls)
    const currentMessages: any[] = [
        systemMessage,
        ...dbMessages.map((m: any) => ({ role: m.role, content: m.content }))
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
          const toolRows = db.prepare(`SELECT name, description, input_schema FROM tools WHERE enabled = 1`).all() as any[];
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


    let finalResponse = '';
    let turnCount = 0;
    let allowAllOverride = false; // Session-based allow all

    // AGENT LOOP
    while (turnCount < MAX_TURNS) {
        turnCount++;
        let toolCallOccurred = false;
        let completionOccurred = false;

        try {
            if (process.env.NODE_ENV !== 'production') {
                printRequestStartSeparator();
            }
            await streamAIAPI(
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

                    if (toolCall.name === 'AttemptCompletion') {
                        completionOccurred = true;
                        resultStr = toolCall.input.result || 'Task completed.';
                        if (process.env.NODE_ENV !== 'production') console.log('>>> COMPLETION ATTEMPTED:', resultStr);
                        
                        // Send as chunk so it appears in UI
                        _event.sender.send('chat:chunk', { conversationId, content: resultStr });
                        finalResponse += resultStr;
                        
                    } else if (toolCall.name === 'ToolSearch') {
                        // Execute Tool Search
                         _event.sender.send('chat:chunk', { conversationId, content: `\n\n> 🔍 Searching tools for: "${toolCall.input.query}"...\n` });
                        if (process.env.NODE_ENV !== 'production') console.log(`>>> Executing ToolSearch: ${toolCall.input.query}`);
                        const foundTools = await callToolsModel(toolCall.input.query, dbService);
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
                            query: toolCall.input.query,
                            found: foundTools.length,
                            tools: foundTools,
                            reasoning: `Found ${foundTools.length} tools. Added to available tools: ${foundNames}`
                        });
                        
                    } else {
                        // Bash, Skill, or other Tools -> REQUIRE PERMISSION
                        
                        // 1. Analyze Safety
                        if (process.env.NODE_ENV !== 'production') console.log(`>>> Analyzing command safety for ${toolCall.name}...`);
                        const analysis = await analyzeCommand(
                            toolCall.name === 'Bash' ? toolCall.input.command : JSON.stringify(toolCall.input),
                            {
                                type: provider.type,
                                endpoint: provider.endpoint || 'https://api.openai.com/v1',
                                apiKey,
                                model: modelToUse // Use same model for analysis or toolModel? 
                                // Plan said "Use Tools Model for safety". 
                                // Let's try to use toolModel for safety if available, else current.
                            }
                        );
                        if (process.env.NODE_ENV !== 'production') console.log('>>> Safety Analysis:', JSON.stringify(analysis, null, 2));

                        // Quick override check
                        // If tool is explicitly safe (needsPermission=false) OR allowAllOverride is true
                        const isSafe = (toolCall.name === 'Bash' && analysis.needsPermission === false);
                        const isSkill = toolCall.name.toLowerCase().includes('skill'); // Skills might be safe? Let's default to confirm.
                        

                        if (allowAllOverride || isSafe) {
                             if (process.env.NODE_ENV !== 'production') console.log('>>> Auto-approving tool execution');
                             // Execute immediately
                             const res = await invokeToolExecution(toolCall.name, toolCall.input);
                             
                             let displayResult = res.result || res.error || 'Done';
                             // For Bash, prepend the command so it shows in the console window
                             if (toolCall.name === 'Bash') {
                                 displayResult = `> ${toolCall.input.command}\n\n${displayResult}`;
                             }

                             // Send result to UI for display (Console Output) -- Skip for Skills
                             if (!isSkill) {
                                 _event.sender.send('chat:tool-result', { 
                                     conversationId, 
                                     toolName: toolCall.name, 
                                     result: displayResult 
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
                                    
                                    const skillNameInput = toolCall.input.skill || toolCall.input.name;
                                    if (skillNameInput) {
                                         const allSkills = db.prepare('SELECT * FROM skills').all() as any[];
                                         const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                                         const target = normalize(skillNameInput);
                                         const skill = allSkills.find(s => normalize(s.name) === target || normalize(s.skill_folder) === target);
                                         
                                         if (skill) {
                                             const dir = db.prepare('SELECT path FROM skill_directories WHERE id = ?').get(skill.skill_directory_id) as any;
                                             if (dir) {
                                                 const expandPath = (p: string) => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
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
                                analysis,
                                skillPath 
                            });
                            
                            // Wait for UI
                            const approval = await approvalPromise;
                            if (process.env.NODE_ENV !== 'production') console.log('>>> User approval result:', approval);
                            
                            if (approval.approved) {
                                if (approval.approvedAll) allowAllOverride = true;
                                const res = await invokeToolExecution(toolCall.name, toolCall.input);
                                
                                let displayResult = res.result || res.error || 'Done';
                                if (toolCall.name === 'Bash') {
                                    displayResult = `> ${toolCall.input.command}\n\n${displayResult}`;
                                }
                                
                                resultStr = res.result || res.error || 'Done'; // Keep raw result for context

                                // Send result to UI for display (Console Output) -- Skip for Skills
                                if (!isSkill) {
                                    _event.sender.send('chat:tool-result', { 
                                        conversationId, 
                                        toolName: toolCall.name, 
                                        result: displayResult 
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
                }
            );

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
                 return { response: finalResponse };
            }
            console.error('Agent loop error', err);
            return { response: finalResponse, error: (err as Error).message };
        }
    }

    // Save final response (accumulated) to DB
    // Note: The intermediate chunks were already sent to UI. 
    // We just save the text content to DB for history.
    // If we want to save the *whole* chain, we need to save intermediate messages.
    // For now, save the final aggregated text.
    chatService.addMessage(conversationId, 'assistant', finalResponse);
    
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
        let apiKey = null;
        if (provider.api_key_encrypted && crypto.isUnlocked()) {
             try { apiKey = crypto.decrypt(provider.api_key_encrypted); } catch {}
        }
        
        const messages = [
            { role: 'system', content: TOOL_SEARCH_PROMPT },
            { role: 'user', content: `Search query: "${query}"\n\nFind all tools that match this query and return as JSON.` }
        ];

        if (process.env.NODE_ENV !== 'production') {
             printRequestStartSeparator();
             console.log('--- TOOL SEARCH REQUEST ---');
             console.log('URL:', `${provider.endpoint || 'https://api.openai.com/v1'}/chat/completions`);
             console.log('Model:', model);
             console.log('Messages:', JSON.stringify(messages, null, 2));
        }

        // Call API (non-streaming)
        const response = await fetch(`${provider.endpoint || 'https://api.openai.com/v1'}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0,
                max_tokens: 2000
            })
        });
        printRequestEndSeparator();
        
        if (!response.ok) {
             console.error(`ToolSearch API failed: ${response.status} - ${await response.text()}`);
             return [];
        }
        
        const data = await response.json() as any;
        
        if (process.env.NODE_ENV !== 'production') {
             printRespondStartSeparator();
             console.log('\n--- TOOL SEARCH RESPONSE ---');
             console.log('Status:', response.status);
             console.log('Body:', JSON.stringify(data, null, 2));
             printRespondEndSeparator();
        }

        const jsonStr = data.choices?.[0]?.message?.content || '';
        
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

// Helper: Local execution of tools (reused logic from chat:execute-tool)
async function invokeToolExecution(toolName: string, toolInput: any): Promise<{ success: boolean; result?: string; error?: string }> {
    // We can reuse the existing IPC handler logic by extracting it or calling it.
    // Since we are in main process, let's extract the logic from the existing handler (lines 255-325)
    // refactoring would be better but for now let's duplicate or call the registered handler if possible?
    // We can't easily call other handlers. I'll copy the logic for now or move it to a function.
    
    // ... Copy of logic ...
      try {
      if (toolName === 'Bash') {
        const { exec } = require('child_process');
        const workspacePath = getDatabase().getSetting('workspacePath') || 
          require('path').join(require('os').homedir(), '.config', 'tiginal', 'workspaces');
        
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

      if (toolName.toLowerCase() === 'skill' || toolName.toLowerCase() === 'executeskill') {
          const db = getDatabase().getDb();
          const path = require('path');
          const fs = require('fs');
          const os = require('os');
          
          const skillNameInput = toolInput.skill || toolInput.name;
          if (!skillNameInput) return { success: false, error: 'Skill name required' };

          const allSkills = db.prepare('SELECT * FROM skills').all() as any[];
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const target = normalize(skillNameInput);
          const skill = allSkills.find(s => normalize(s.name) === target || normalize(s.skill_folder) === target);
          
          if (!skill) return { success: false, error: `Skill not found: ${skillNameInput}` };
          
          const dir = db.prepare('SELECT path FROM skill_directories WHERE id = ?').get(skill.skill_directory_id) as any;
          if (!dir) return { success: false, error: 'Skill directory error' };
          
          const expandPath = (p: string) => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
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

function processLine(
    line: string, 
     onChunk: (data: { content?: string; reasoning?: string }) => void,
     toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }>,
     logAccumulator?: LogAccumulator
) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") return;
    
    if (trimmed.startsWith("data: ")) {
        const jsonStr = trimmed.substring(6);
        try {
            const data = JSON.parse(jsonStr);

            const delta = data.choices?.[0]?.delta;
            
            if (delta) {
                if (delta.content || delta.reasoning) {
                   onChunk({ content: delta.content, reasoning: delta.reasoning });
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
                 updateLogAccumulator(logAccumulator, data, toolCallAccumulator);
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
    toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }>
) {
     if (!acc.id && data.id) acc.id = data.id;
     if (!acc.model && data.model) acc.model = data.model;
     if (!acc.created && data.created) acc.created = data.created;
     if (!acc.usage && data.usage) acc.usage = data.usage;
     
     const choice = data.choices?.[0];
     if (choice) {
         if (choice.delta?.role && !acc.role) acc.role = choice.delta.role;
         if (choice.delta?.content) acc.contentParts.push(choice.delta.content);
         if (choice.delta?.reasoning) acc.reasoningParts.push(choice.delta.reasoning);
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
