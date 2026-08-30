import { JsonObject } from './tool-input';

export type ToolRiskLevel = 'safe' | 'low' | 'medium' | 'high';

export interface ToolApprovalAnalysis {
  needsPermission: boolean;
  description: string;
  riskLevel: ToolRiskLevel;
}

export function isToolRiskLevel(value: unknown): value is ToolRiskLevel {
  return value === 'safe' || value === 'low' || value === 'medium' || value === 'high';
}

function stringArgument(input: JsonObject, name: string): string {
  const value = input[name];
  return typeof value === 'string' ? value : '';
}

export function analyzeNonShellTool(toolName: string, input: JsonObject): ToolApprovalAnalysis {
  switch (toolName) {
    case 'WebSearch': {
      const query = stringArgument(input, 'query');
      const count = typeof input.max_results === 'number' ? ` and return up to ${input.max_results} results` : '';
      return {
        needsPermission: true,
        description: `Search the web for "${query}" using the current search service${count}. The query will be sent to the selected search service.`,
        riskLevel: 'low',
      };
    }
    case 'WebFetch': {
      const url = stringArgument(input, 'url');
      return {
        needsPermission: true,
        description: `Read ${url} and return the page content to the model.`,
        riskLevel: 'low',
      };
    }
    case 'Skill':
    case 'ExecuteSkill':
      return {
        needsPermission: false,
        description: 'Read the local skill instructions without running any commands from them.',
        riskLevel: 'safe',
      };
    default:
      return {
        needsPermission: true,
        description: `Run the ${toolName} tool with the arguments shown below.`,
        riskLevel: 'medium',
      };
  }
}
