## 🎅 SantaPhone

SantaPhone is a festive demo that lets you place a simulated phone call to Santa Claus from your browser. The app establishes a WebRTC connection to the OpenAI Realtime API, streams your microphone audio to the model, and plays back Santa's voice in real time. It showcases how to combine Next.js, modern browser media APIs, and OpenAI's turn-detection features to build a natural-feeling conversational experience.【F:app/page.tsx†L1-L210】【F:app/api/sdp/route.ts†L1-L78】

### How it works

1. **Client UI** – `app/page.tsx` renders a “phone” interface with call controls, microphone activity indicators, and optional debug logs.【F:app/page.tsx†L21-L210】
2. **WebRTC setup** – When you press call, the client creates a `RTCPeerConnection`, adds audio/video transceivers, and gathers ICE candidates. A data channel is opened to send session instructions (a Santa-themed system prompt, preferred voice, and turn-detection settings) and to receive debug messages.【F:app/page.tsx†L29-L125】
3. **Microphone capture & VAD** – After the initial greeting, the app captures microphone audio, replaces the negotiated sender track, and runs a lightweight RMS-based VAD to animate the “talking” indicator.【F:app/page.tsx†L127-L209】
4. **Server handshake** – The gathered SDP offer is POSTed to the Next.js API route at `app/api/sdp/route.ts`, which forwards it to OpenAI's Realtime endpoint using the configured model and returns the SDP answer back to the browser.【F:app/api/sdp/route.ts†L1-L78】

Together these pieces give you a low-latency, full-duplex voice chat with a pre-configured Santa persona defined in `lib/santaPrompt.ts`.

## Getting Started

### Prerequisites

- Node.js 18 or later (Next.js 15 requirement)
- An OpenAI API key with access to the Realtime models

### Installation

```bash
npm install
```

Create a `.env.local` file in the project root and set the OpenAI credentials:

```bash
OPENAI_API_KEY=sk-...
# Optional: override the default realtime model
```

### Running the dev server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in a Chromium-based browser and press the green call button. The browser will request microphone access—grant it to begin chatting. Toggle the “Показать лог” link to inspect the raw signalling and diagnostic messages during the call.【F:app/page.tsx†L21-L210】

## Customization Tips

- **Prompt & persona:** Adjust Santa's behavior in `lib/santaPrompt.ts` to change what he says or how he behaves.
- **Voice & model:** Update the constants in `app/page.tsx` or set `OPENAI_REALTIME_MODEL` to try different realtime voices and models.【F:app/page.tsx†L11-L76】【F:app/api/sdp/route.ts†L16-L59】
- **Security:** For production deployments, restrict the allowed models list in `app/api/sdp/route.ts` or implement additional auth before exchanging SDP offers.【F:app/api/sdp/route.ts†L16-L59】

## Deployment

Deploy like any standard Next.js 15 application (e.g., Vercel, Netlify, or a custom Node host). Ensure the `OPENAI_API_KEY` (and optional `OPENAI_REALTIME_MODEL`) environment variables are configured in the hosting platform so the API route can complete the handshake with OpenAI Realtime.【F:app/api/sdp/route.ts†L24-L77】
