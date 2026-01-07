/**
 * Twilio Media Stream Handler for Gemini AI Calls
 */

import { WebSocket } from 'ws';
import { geminiClient, GeminiVoice } from '../services/geminiClient.js';
import { pcm2ulaw, ulaw2pcm, resample, calculateRMS } from '../utils/audioCodec.js';
import { getCallScript } from '../config/callScripts.js';
import { toolRegistry } from '../services/toolRegistry.js';

const MAX_CALL_DURATION = 5 * 60 * 1000; // 5 minutes for demo
const SILENCE_TIMEOUT = 15 * 1000; // 15 seconds
const BARGE_IN_THRESHOLD = 5000; // RMS threshold for interrupt detection

interface TwilioStreamMessage {
  event: 'start' | 'media' | 'stop';
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    track: 'inbound' | 'outbound';
    payload: string;
  };
  stop?: {
    callSid: string;
  };
}

interface CallSession {
  callSid: string;
  streamSid: string;
  phoneNumber: string;
  voiceId: string;
  twilioWs: WebSocket;
  conversationLog: Array<{ role: 'user' | 'model'; text: string; timestamp: string }>;
  startTime: number;
  lastActivityTime: number;
  isActive: boolean;
  aiTurnCount: number;
}

const activeSessions = new Map<string, CallSession>();

export async function handleCallWebSocket(ws: WebSocket, queryParams: URLSearchParams) {
  let phoneNumber: string = queryParams.get('phoneNumber') || 'unknown';
  let voiceId: string = (queryParams.get('voiceId') || 'Puck') as GeminiVoice;

  let session: CallSession | null = null;
  let silenceTimer: NodeJS.Timeout | null = null;
  let maxDurationTimer: NodeJS.Timeout | null = null;

  console.log('[CallHandler] New Twilio stream connection');

  ws.on('message', async (data: Buffer) => {
    try {
      const message: TwilioStreamMessage = JSON.parse(data.toString());

      switch (message.event) {
        case 'start':
          await handleStart(message);
          break;

        case 'media':
          await handleMedia(message);
          break;

        case 'stop':
          await handleStop(message);
          break;
      }
    } catch (error) {
      console.error('[CallHandler] Error processing message:', error);
    }
  });

  ws.on('close', async () => {
    console.log('[CallHandler] Twilio stream disconnected');
    await cleanup();
  });

  ws.on('error', async (error) => {
    console.error('[CallHandler] WebSocket error:', error);
    await cleanup();
  });

  async function handleStart(message: TwilioStreamMessage) {
    if (!message.start) return;

    const { streamSid, callSid, customParameters } = message.start;

    if (customParameters) {
      phoneNumber = customParameters.phoneNumber || phoneNumber;
      voiceId = customParameters.voiceId || voiceId;
    }

    console.log(`[CallHandler] Stream started: ${streamSid}, Call: ${callSid}, Phone: ${phoneNumber}`);

    try {
      const script = getCallScript();
      const tools = toolRegistry.getToolsForGemini();

      await geminiClient.connect({
        systemInstruction: script.systemInstruction,
        voiceName: voiceId as GeminiVoice,
        tools,
      });

      session = {
        callSid,
        streamSid,
        phoneNumber,
        voiceId,
        twilioWs: ws,
        conversationLog: [],
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        isActive: true,
        aiTurnCount: 0,
      };

      activeSessions.set(callSid, session);

      maxDurationTimer = setTimeout(async () => {
        console.log('[CallHandler] Max duration reached, ending call');
        await endCall('max_duration');
      }, MAX_CALL_DURATION);

      receiveFromGemini().catch((err) => {
        console.error('[CallHandler] Error in receiveFromGemini:', err);
      });

      // Send initial greeting
      await geminiClient.sendMessage(script.openingMessage);
    } catch (error) {
      console.error('[CallHandler] Error in handleStart:', error);
      ws.close(1011, 'Internal error');
    }
  }

  async function handleMedia(message: TwilioStreamMessage) {
    if (!message.media || !session || message.media.track !== 'inbound') return;

    try {
      session.lastActivityTime = Date.now();
      if (silenceTimer) clearTimeout(silenceTimer);

      silenceTimer = setTimeout(async () => {
        console.log('[CallHandler] Silence timeout, ending call');
        await endCall('silence_timeout');
      }, SILENCE_TIMEOUT);

      const ulawBuffer = Buffer.from(message.media.payload, 'base64');
      const pcm8k = ulaw2pcm(ulawBuffer);
      const rms = calculateRMS(pcm8k);

      // Barge-in detection
      if (rms > BARGE_IN_THRESHOLD) {
        ws.send(
          JSON.stringify({
            event: 'clear',
            streamSid: session.streamSid,
          })
        );
      }

      if (!geminiClient.isConnected()) {
        return;
      }

      const pcm24k = resample(pcm8k, 8000, 24000);
      await geminiClient.sendAudio(pcm24k);
    } catch (error) {
      console.error('[CallHandler] Error processing media:', error);
    }
  }

  async function handleStop(message: TwilioStreamMessage) {
    console.log('[CallHandler] Stream stopped by Twilio');
    await endCall('completed');
  }

  async function receiveFromGemini() {
    if (!session || !session.isActive) {
      console.log('[CallHandler] receiveFromGemini: Session not active');
      return;
    }

    console.log('[CallHandler] Starting to receive from Gemini...');

    try {
      while (session.isActive) {
        const response = await geminiClient.receive();

        if (!response) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        if (response.serverContent?.turnComplete) {
          session.aiTurnCount++;
          console.log(`[CallHandler] AI turn ${session.aiTurnCount} complete`);

          // Auto-end after 5 turns (demo limit)
          if (session.aiTurnCount >= 5) {
            console.log('[CallHandler] Max turns reached, ending call in 2 seconds...');
            setTimeout(async () => {
              await endCall('completed');
            }, 2000);
          }
        }

        // Handle tool calls
        const toolCall = response.serverContent?.modelTurn?.toolCall || (response as any).toolCall;

        if (toolCall) {
          const functionCalls = toolCall.functionCalls || [];

          for (const call of functionCalls) {
            const { id, name, args } = call;
            console.log(`[CallHandler] Tool call: ${name}`, args);

            const result = await toolRegistry.executeTool(name, args);
            console.log(`[CallHandler] Tool result:`, result);

            let shouldEndCall = false;

            if (result.action === 'end_call') {
              console.log(`[CallHandler] Call will end after AI speaks`);
              shouldEndCall = true;
            }

            const geminiResponse = {
              success: result.success,
              message: result.message,
            };

            await geminiClient.sendToolResponse(id, name, geminiResponse);

            if (shouldEndCall) {
              setTimeout(async () => {
                await endCall('ai_requested');
              }, 3000);
            }
          }
        }

        // Handle audio response
        if (response.serverContent?.modelTurn?.parts) {
          for (const part of response.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
              const pcm24k = Buffer.from(part.inlineData.data, 'base64');
              const pcm8k = resample(pcm24k, 24000, 8000);
              const ulawBuffer = pcm2ulaw(pcm8k);

              const mediaMessage = {
                event: 'media',
                streamSid: session.streamSid,
                media: {
                  payload: ulawBuffer.toString('base64'),
                },
              };
              ws.send(JSON.stringify(mediaMessage));
            }

            // Handle text transcript
            if (part.text) {
              session.conversationLog.push({
                role: 'model',
                text: part.text,
                timestamp: new Date().toISOString(),
              });

              console.log(`[AI]: ${part.text}`);

              // Auto-end on goodbye phrases
              const lowerText = part.text.toLowerCase();
              const endCallPhrases = ['goodbye', 'bye', 'take care', 'have a great day'];

              if (endCallPhrases.some((phrase) => lowerText.includes(phrase))) {
                console.log('[CallHandler] AI said goodbye, ending call in 2 seconds...');
                setTimeout(async () => {
                  await endCall('completed');
                }, 2000);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[CallHandler] Error receiving from Gemini:', error);
      await endCall('error');
    }
  }

  async function endCall(reason: string) {
    if (!session) return;

    console.log(`[CallHandler] Ending call: ${reason}`);
    session.isActive = false;

    if (silenceTimer) clearTimeout(silenceTimer);
    if (maxDurationTimer) clearTimeout(maxDurationTimer);

    const duration = Math.floor((Date.now() - session.startTime) / 1000);

    try {
      console.log(`[CallHandler] Call duration: ${duration}s`);
      console.log(`[CallHandler] Conversation log:`, session.conversationLog);

      await geminiClient.close();

      if (session.twilioWs && session.twilioWs.readyState === WebSocket.OPEN) {
        console.log('[CallHandler] Closing Twilio WebSocket connection...');
        session.twilioWs.close(1000, 'Call ended');
      }

      activeSessions.delete(session.callSid);
    } catch (error) {
      console.error('[CallHandler] Error ending call:', error);
    }
  }

  async function cleanup() {
    if (session && session.isActive) {
      await endCall('disconnected');
    }

    if (silenceTimer) clearTimeout(silenceTimer);
    if (maxDurationTimer) clearTimeout(maxDurationTimer);
  }
}

export function getActiveSessions() {
  return Array.from(activeSessions.values());
}
