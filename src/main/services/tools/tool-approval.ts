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
      const count = typeof input.max_results === 'number' ? `，最多返回 ${input.max_results} 条结果` : '';
      return {
        needsPermission: true,
        description: `使用当前搜索服务在网络上搜索“${query}”${count}。搜索词会发送给所选搜索服务。`,
        riskLevel: 'low',
      };
    }
    case 'WebFetch': {
      const url = stringArgument(input, 'url');
      return {
        needsPermission: true,
        description: `读取网页 ${url} 并将页面内容返回给模型。`,
        riskLevel: 'low',
      };
    }
    case 'Skill':
    case 'ExecuteSkill':
      return {
        needsPermission: false,
        description: '读取本地 Skill 说明，不执行其中的命令。',
        riskLevel: 'safe',
      };
    default:
      return {
        needsPermission: true,
        description: `运行工具 ${toolName}，参数见下方。`,
        riskLevel: 'medium',
      };
  }
}
