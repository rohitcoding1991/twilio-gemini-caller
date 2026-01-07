/**
 * Gemini 2.0 Live API Client
 *
 * WebSocket client for real-time AI voice conversations using Google's Gemini 2.0 Live API
 */

import WebSocket from 'ws';

export type GeminiVoice = 'Puck' | 'Charon' | 'Fenrir' | 'Kore' | 'Aoede' | 'Leda' | 'Orus' | 'Zephyr';

export interface GeminiTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface GeminiResponse {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data: string; // base64
          mimeType: string;
        };
      }>;
      toolCall?: {
        functionCalls: Array<{
          id: string;
          name: string;
          args: Record<string, any>;
        }>;
      };
    };
    turnComplete?: boolean;
  };
  toolCall?: {
    functionCalls: Array<{
      id: string;
      name: string;
      args: Record<string, any>;
    }>;
  };
  setupComplete?: boolean;
}

export interface GeminiConnectConfig {
  systemInstruction: string;
  voiceName: GeminiVoice;
  tools?: GeminiTool[];
  model?: string;
}

export class GeminiClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private model: string;
  private isSetupComplete = false;
  private pendingResponses: Array<(value: GeminiResponse | null) => void> = [];

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    this.model = 'gemini-2.0-flash-exp';

    if (!this.apiKey) {
      console.warn('[Gemini] GOOGLE_API_KEY not configured');
    }
  }

  async connect(config: GeminiConnectConfig): Promise<void> {
    const uri = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    console.log('[Gemini] Connecting to Live API...');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(uri);

      this.ws.on('open', async () => {
        console.log('[Gemini] Connected');

        const setupMsg = {
          setup: {
            model: `models/${config.model || this.model}`,
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: config.voiceName,
                  },
                },
              },
            },
            system_instruction: {
              parts: [{ text: config.systemInstruction }],
            },
          },
        };

        if (config.tools && config.tools.length > 0) {
          (setupMsg.setup as any).tools = [
            {
              function_declarations: config.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ];
        }

        this.ws!.send(JSON.stringify(setupMsg));

        this.ws!.once('message', (data: Buffer) => {
          const response = JSON.parse(data.toString()) as GeminiResponse;
          if (response.setupComplete) {
            this.isSetupComplete = true;
            console.log('[Gemini] Setup complete');
            resolve();
          } else {
            reject(new Error('Gemini setup failed'));
          }
        });
      });

      this.ws.on('error', (error) => {
        console.error('[Gemini] WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[Gemini] WebSocket closed (${code})`);
        this.isSetupComplete = false;
      });

      this.ws.on('message', (data: Buffer) => {
        if (!this.isSetupComplete) return;

        const response = JSON.parse(data.toString()) as GeminiResponse;
        if (this.pendingResponses.length > 0) {
          const resolve = this.pendingResponses.shift();
          resolve?.(response);
        }
      });
    });
  }

  async sendAudio(audioChunk: Buffer): Promise<void> {
    if (!this.ws || !this.isSetupComplete) {
      throw new Error('Gemini client not connected');
    }

    const base64Audio = audioChunk.toString('base64');
    const msg = {
      realtime_input: {
        media_chunks: [
          {
            mime_type: 'audio/pcm;rate=24000',
            data: base64Audio,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.ws || !this.isSetupComplete) {
      throw new Error('Gemini client not connected');
    }

    const msg = {
      client_content: {
        turns: [
          {
            role: 'user',
            parts: [{ text: message }],
          },
        ],
        turn_complete: true,
      },
    };

    this.ws.send(JSON.stringify(msg));
    console.log(`[Gemini] Sent message: ${message.substring(0, 100)}...`);
  }

  async sendToolResponse(toolId: string, functionName: string, result: any): Promise<void> {
    if (!this.ws || !this.isSetupComplete) {
      throw new Error('Gemini client not connected');
    }

    const msg = {
      tool_response: {
        function_responses: [
          {
            id: toolId,
            name: functionName,
            response: result,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(msg));
    console.log(`[Gemini] Tool response sent: ${functionName}`);
  }

  async receive(): Promise<GeminiResponse | null> {
    if (!this.ws || !this.isSetupComplete) {
      return null;
    }

    return new Promise((resolve) => {
      this.pendingResponses.push(resolve);

      const closeHandler = () => {
        const index = this.pendingResponses.indexOf(resolve);
        if (index > -1) {
          this.pendingResponses.splice(index, 1);
        }
        resolve(null);
      };

      this.ws!.once('close', closeHandler);

      const originalResolve = this.pendingResponses[this.pendingResponses.length - 1];
      this.pendingResponses[this.pendingResponses.length - 1] = (value) => {
        this.ws!.off('close', closeHandler);
        originalResolve(value);
      };
    });
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.pendingResponses.forEach((resolve) => resolve(null));
      this.pendingResponses = [];
      this.ws.close();
      this.ws = null;
      this.isSetupComplete = false;
      console.log('[Gemini] Connection closed');
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isSetupComplete;
  }
}

export const geminiClient = new GeminiClient();
