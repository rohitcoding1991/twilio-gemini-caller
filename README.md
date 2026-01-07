# Twilio + Gemini AI Caller Demo

A minimal working example of AI-powered phone calling using **Twilio Media Streams** and **Google Gemini 2.0 Live API**.

## Features

- Real-time AI voice conversations over the phone
- Twilio Media Streams for WebSocket-based audio streaming
- Google Gemini 2.0 for AI conversation handling
- Audio codec conversion (μ-law ↔ PCM, 8kHz ↔ 24kHz)
- Barge-in detection for natural conversation flow
- Multiple AI voice options (8 different voices)
- Simple web interface for initiating calls

## Architecture

```
Phone Call (Twilio) → WebSocket Stream → Backend
                                           ↓
                                    Audio Codec Conversion
                                           ↓
                                    Gemini 2.0 Live API
                                           ↓
                                    AI Response (Voice)
                                           ↓
                                    Audio Codec Conversion
                                           ↓
                                    Back to Phone (Twilio)
```

## Prerequisites

1. **Twilio Account**
   - Sign up at [https://www.twilio.com/](https://www.twilio.com/)
   - Get Account SID, Auth Token, and a phone number
   - Verify your phone number or upgrade for production use

2. **Google Cloud Account**
   - Create a project at [https://console.cloud.google.com/](https://console.cloud.google.com/)
   - Enable Gemini API
   - Get API key from [https://ai.google.dev/](https://ai.google.dev/)

3. **Node.js**
   - Version 18 or higher
   - npm or yarn

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/rohitcoding1991/twilio-gemini-caller.git
cd twilio-gemini-caller
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

Create a `.env` file in the `backend` directory:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# Google Gemini API
GOOGLE_API_KEY=your_google_api_key_here

# WebSocket Public URL
PUBLIC_WS_URL=ws://localhost:5000/ws
```

### 4. Start the backend server

```bash
npm run dev
```

You should see:

```
╔═══════════════════════════════════════════════════╗
║   Twilio + Gemini AI Caller Demo Server          ║
╚═══════════════════════════════════════════════════╝

Server running on: http://localhost:5000
WebSocket URL: ws://localhost:5000/ws

Twilio configured: true
Gemini configured: true

Ready to make AI calls!
```

### 5. Open the frontend

Open `frontend/index.html` in your browser, or serve it with a simple HTTP server:

```bash
cd frontend
npx http-server -p 3000
```

Then visit `http://localhost:3000`

## Usage

1. Open the web interface
2. Check that all services show "Ready"
3. Enter a phone number (must be in E.164 format, e.g., `+1234567890`)
4. Select an AI voice
5. Click "Start AI Call"
6. The system will call the number and the AI will have a conversation

## API Endpoints

### `GET /health`
Health check endpoint

### `GET /api/status`
Get system configuration status

### `POST /api/calls/initiate`
Initiate a new AI call

**Request:**
```json
{
  "phoneNumber": "+1234567890",
  "voiceId": "Puck"
}
```

**Response:**
```json
{
  "success": true,
  "callSid": "CA...",
  "phoneNumber": "+1234567890",
  "status": "queued"
}
```

### `POST /api/calls/twiml`
TwiML endpoint for Twilio (automatically called by Twilio)

## Available AI Voices

- **Puck** (Default) - Friendly and energetic
- **Charon** - Deep and authoritative
- **Fenrir** - Warm and professional
- **Kore** - Clear and articulate
- **Aoede** - Soft and gentle
- **Leda** - Neutral and balanced
- **Orus** - Strong and confident
- **Zephyr** - Light and airy

## How It Works

### 1. Call Initiation
- User submits phone number through web interface
- Backend calls Twilio API to initiate call
- Twilio dials the number and connects to our TwiML endpoint

### 2. WebSocket Stream Setup
- TwiML instructs Twilio to stream audio to our WebSocket
- Backend receives `start` event with call metadata
- Gemini client connects and initializes with AI instructions

### 3. Audio Processing Loop
- **Inbound audio (User speaking):**
  - Twilio sends μ-law 8kHz audio chunks
  - Convert μ-law → PCM
  - Resample 8kHz → 24kHz
  - Send to Gemini for processing

- **Outbound audio (AI speaking):**
  - Receive PCM 24kHz from Gemini
  - Resample 24kHz → 8kHz
  - Convert PCM → μ-law
  - Send back to Twilio

### 4. Conversation Management
- Barge-in detection allows natural interruptions
- Silence timeout (15s) ends idle calls
- Max duration limit (5 minutes for demo)
- Auto-end on goodbye phrases

### 5. Call Termination
- User hangs up
- AI says goodbye
- Timeout reached
- Error occurs

## Project Structure

```
twilio-gemini-caller/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── callScripts.ts      # AI conversation scripts
│   │   ├── services/
│   │   │   ├── geminiClient.ts     # Gemini API client
│   │   │   └── toolRegistry.ts     # Function calling tools
│   │   ├── utils/
│   │   │   └── audioCodec.ts       # Audio conversion utilities
│   │   ├── websocket/
│   │   │   └── callHandler.ts      # WebSocket call handler
│   │   └── server.ts               # Main server
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/
│   └── index.html                  # Web interface
└── README.md
```

## Development

### Build for production

```bash
cd backend
npm run build
npm start
```

### Run in development mode

```bash
cd backend
npm run dev
```

## Deployment

For production deployment, you need:

1. **Public HTTPS URL** for your backend
2. **Update `.env`:**
   - `PUBLIC_WS_URL=wss://yourdomain.com/ws`
   - Use secure WebSocket (wss://)
3. **Configure Twilio webhooks** to point to your public URL
4. **Verify phone numbers** or get Twilio approval for unrestricted calling

### Deploy to Heroku, Railway, Render, etc.

1. Set environment variables in your platform
2. Deploy the `backend` directory
3. Update `API_URL` in `frontend/index.html` to your backend URL
4. Deploy frontend separately or serve static files from backend

## Limitations (Demo)

- Max call duration: 5 minutes
- Max conversation turns: 5
- No database persistence
- No call history or recordings storage
- Basic error handling
- Single concurrent call handling

## Troubleshooting

### "Twilio not configured"
- Check that all Twilio env vars are set correctly
- Verify Account SID and Auth Token
- Ensure phone number is in E.164 format

### "Gemini not configured"
- Verify `GOOGLE_API_KEY` is set
- Check API key is valid and has Gemini API enabled

### "Call connects but no audio"
- Check WebSocket URL is accessible
- Verify firewall allows WebSocket connections
- Check browser console for errors

### "AI doesn't respond"
- Check backend logs for Gemini connection errors
- Verify API key has sufficient quota
- Check network connectivity to Google APIs

## Technologies Used

- **Backend:** Node.js, TypeScript, Express
- **Telephony:** Twilio Voice, Media Streams
- **AI:** Google Gemini 2.0 Live API
- **WebSocket:** ws library
- **Audio Processing:** Custom PCM/μ-law codec

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [Twilio Media Streams Documentation](https://www.twilio.com/docs/voice/media-streams)
- [Google Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)

## Support

If you encounter any issues or have questions, please open an issue on GitHub:
https://github.com/rohitcoding1991/twilio-gemini-caller/issues
