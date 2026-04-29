<p align="center">
  <img src="logo.png" width="90" alt="Remote Runner Logo" />
</p>

# Remote Runner for Claude

> **Disclaimer:** This is an unofficial community project and is not affiliated with, endorsed by, or associated with Anthropic. "Claude" is a trademark of Anthropic.

[![npm version](https://badge.fury.io/js/@sohampawar1866%2Fremote-claude.svg)](https://www.npmjs.com/package/@sohampawar1866/remote-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A cross-platform CLI wrapper and Progressive Web App (PWA) that lets you control [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) remotely. Watch Claude code in real-time on your phone via WebRTC, get push notifications when it pauses for input, and respond directly from your mobile device.

## Features

- **Live Terminal Mirroring (WebRTC)** - Watch Claude's output stream in real-time directly on your phone with zero latency over a secure peer-to-peer data channel.
- **Rich UI Parsing** - The mobile dashboard automatically parses raw ANSI streams into beautiful, native markdown and code blocks, fully preserving terminal colors.
- **Instant QR Pairing** - Simply scan the QR code printed in your terminal to instantly establish a WebRTC connection. No manual URL copying required.
- **Late Joiner History Burst** - If you scan the QR code after Claude has been running for a while, you immediately receive the full terminal history so you never miss context.
- **Adaptive PTY Resizing** - The mobile app automatically sends your phone's screen dimensions to the CLI, which resizes the pseudo-terminal for a pixel-perfect mobile view.
- **Auto-Reconnect** - If your phone goes to sleep or loses network, the app automatically renegotiates a new WebRTC tunnel when it wakes up.
- **Reliable Pause Detection** - 4-layer hybrid detection engine with prompt box structural parsing, Claude Code lifecycle hooks, silence-based fallback, and a state machine.
- **Hybrid Appwrite Signaling** - The CLI uses secure HTTP polling to avoid Node.js WebSocket limitations (preventing `window is not defined` crashes), while the mobile app uses Appwrite Realtime WebSockets for instant delivery.
- **Remote Control & Push Notifications** - Get alerted via ntfy.sh whenever Claude pauses (e.g., approval prompts, tool permissions) and respond from your phone.
- **Zero-Trust Security** - All peer-to-peer connections and signaling data are secured with AES-256-GCM encryption. Nobody can read your code.
- **Cross-Platform Keep-Awake** - Prevents your Mac, Windows, or Linux machine from sleeping during long-running tasks.
- **PWA Home Screen Support** - Session credentials are persisted to `localStorage`, so the app works even when launched from your iOS/Android home screen.

## Installation

Install globally via npm:

```bash
npm install -g @sohampawar1866/remote-claude
```

## Usage

To start a remote session, simply run:

```bash
remote-claude
```

### Options

| Flag | Description |
|------|-------------|
| `-k, --keep-awake` | Prevent the system from sleeping while Claude runs |
| `-d, --debug` | Enable debug logging for pause detection state transitions |
| `--silence-threshold <ms>` | Silence threshold in ms before fallback pause detection (default: `3000`) |
| `--pattern-debounce <ms>` | Pattern match debounce in ms (default: `1500`) |
| `--no-hooks` | Disable automatic Claude Code hook installation |
| `-c, --command <cmd>` | Command to run (default: `claude`) |

### Examples

```bash
# Basic usage — keep machine awake
remote-claude -k

# Debug mode — see state transitions in real time
remote-claude -d
```

On first launch, the CLI prints a QR code. Scan it with your phone's native camera to instantly open the PWA and establish a live WebRTC peer connection.

## Architecture & Security

Security is a core concern for this tool. See the full **[Security Architecture Guide](./docs/SECURITY.md)** for details on the zero-trust WebRTC model.

Here is how the v3.1.1 pipeline works:

1. `remote-claude` wraps the `claude` CLI using `node-pty` and monitors terminal output.
2. The CLI generates a random `channelId` and AES `encryptionKey`.
3. It creates a WebRTC Peer Connection, generates an encrypted SDP Offer, and posts it to Appwrite.
4. It prints a **QR Code** containing these credentials to your terminal.
5. You scan the QR code with your phone. The PWA opens, reads the key from the URL, **persists it to `localStorage`**, then cleans the URL to prevent key leakage.
6. The PWA decrypts the SDP Offer, generates an Answer, and posts it back to Appwrite.
7. The CLI **securely polls** for the Answer (to ensure stability in Node.js) and establishes a direct, zero-latency **WebRTC P2P Data Channel**.
8. The CLI sends a **history burst** (the current terminal buffer) so you see full context immediately.
9. The mobile sends its screen dimensions; the CLI resizes the PTY accordingly.
10. The terminal stream flows directly to your phone via JSON packets (`{type: "stream"}`), where the PWA's Rich UI parser turns raw ANSI text into native code blocks.
11. If your phone goes to sleep and the WebRTC connection breaks, the CLI automatically falls back to Appwrite for push notifications. When you reopen the app, it auto-reconnects WebRTC.

### WebRTC JSON Protocol

The Data Channel uses a structured JSON packet protocol:

| Packet Type | Direction | Description |
|-------------|-----------|-------------|
| `stream` | CLI → Mobile | Real-time terminal output chunk |
| `history` | CLI → Mobile | Full terminal buffer burst for late joiners |
| `input` | Mobile → CLI | User response text |
| `resize` | Mobile → CLI | Terminal dimension sync (`cols`, `rows`) |

## Project Structure

```
claude-remote-runner/
├── bin/                         # CLI entry point
│   └── remote-claude.js         # Main executable (WebRTC + PTY orchestration)
├── docs/                        # Documentation
│   └── SECURITY.md              # Security architecture guide
├── src/                         # CLI source modules
│   ├── config/                  # Configuration and defaults
│   ├── detection/               # Pause detection engine (4-layer hybrid)
│   │   ├── PauseDetector.js     # Core state machine
│   │   ├── patterns.js          # Pattern catalog + prompt box parsing
│   │   ├── hookSetup.js         # Claude Code lifecycle hook integration
│   │   └── index.js             # Barrel export
│   ├── services/                # WebRTC, Appwrite, ntfy
│   │   ├── webrtc.js            # P2P session + JSON protocol + history burst
│   │   ├── appwrite.js          # Polling + signaling
│   │   └── ntfy.js              # Push notifications
│   └── utils/                   # Crypto and keep-awake utilities
├── mobile-app/                  # Self-contained PWA (deploy separately)
│   ├── src/
│   │   ├── components/          # RichTerminal, ChatInput, PromptList
│   │   ├── hooks/               # useWebRTC (reconnect + resize), useRemoteSession (localStorage)
│   │   ├── services/            # Appwrite signaling (Realtime WebSockets) + WebCrypto
│   │   └── App.jsx              # Root component
│   └── vercel.json              # Vercel deployment config
├── LICENSE
├── README.md
└── package.json
```

## Zero-Config Architecture

By default, Remote Runner operates with a **Zero-Config** setup:
- The CLI uses Appwrite purely as an ephemeral signaling server to exchange WebRTC SDP answers.
- The mobile frontend is pre-deployed on Vercel.
- You can simply `npm install -g` and start using it immediately without configuring any environment variables or databases.

**Security**: All P2P stream data never touches a server. The signaling payloads (SDP) that *do* touch the Appwrite database are E2E encrypted with AES-256-GCM *before* they leave your machine.

## Self-Hosting (Optional)

If you prefer total data sovereignty, you can deploy your own instance of the frontend and Appwrite signaling server.

### 1. Self-Hosting the Frontend
1. Fork or clone this repository.
2. Deploy the `mobile-app` directory to Vercel or Netlify.
3. Set your new URL in your CLI's `.env` file:
   ```bash
   FRONTEND_URL=https://your-own-deployment.example.com
   ```

### 2. Self-Hosting the Signaling Backend
1. Create a project on [Appwrite Cloud](https://cloud.appwrite.io/) or self-host via Docker.
2. Create a database (e.g. `remote_runner`).
3. Create a collection named `messages` with these attributes:
   - `sessionId` (String, size 255)
   - `type` (String, size 50)
   - `content` (String, size 1000000)
   - `timestamp` (Datetime)
4. Go to the Indexes tab and create two Key indexes:
   - `sessionId_index` on the `sessionId` attribute
   - `type_index` on the `type` attribute
5. Set collection permissions to **Any** (Create, Read, Update, Delete). This is safe because all data is E2E encrypted before it reaches the database.
6. Configure your `.env` variables accordingly.

## Tech Stack

- **CLI Wrapper**: Node.js, `node-pty`, `node-datachannel`, `strip-ansi`, `commander`
- **Frontend PWA**: React, Vite, `ansi_up`, `vite-plugin-pwa`
- **Transport**: WebRTC (P2P via JSON protocol), Appwrite (Polling CLI + Realtime Mobile)
- **Push Notifications**: ntfy.sh
- **Encryption**: AES-256-GCM (Node.js `crypto` + Web Crypto API)

## Uninstallation

To completely remove the Remote Runner and clear your local configuration:

```bash
remote-claude reset
npm uninstall -g @sohampawar1866/remote-claude
```

## License

MIT. See [LICENSE](./LICENSE).
