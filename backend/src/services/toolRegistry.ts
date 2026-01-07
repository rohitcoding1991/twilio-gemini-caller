/**
 * Tool Registry for Gemini Function Calling
 */

import { GeminiTool } from './geminiClient.js';

export interface ToolResult {
  success?: boolean;
  message?: string;
  action?: string;
  [key: string]: any;
}

export class ToolRegistry {
  getToolsForGemini(): GeminiTool[] {
    return [
      {
        name: 'end_call',
        description: 'End the call gracefully when conversation is complete',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Reason for ending call (completed, user_request)',
            },
          },
          required: ['reason'],
        },
      },
    ];
  }

  async executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
    console.log(`[Tool] Executing: ${toolName}`, args);

    if (toolName === 'end_call') {
      const { reason } = args;
      return {
        action: 'end_call',
        reason,
        message: 'Ending call...',
      };
    }

    return { error: `Unknown tool: ${toolName}` };
  }
}

export const toolRegistry = new ToolRegistry();
