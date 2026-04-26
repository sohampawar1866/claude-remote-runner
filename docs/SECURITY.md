# Security Architecture: Claude Remote Runner

Security is a core concern for any tool that intercepts terminal I/O, especially when dealing with AI prompts that may contain source code. Claude Remote Runner is built on a **zero-trust model** utilizing both WebRTC peer-to-peer tunnels and End-to-End Encrypted (E2EE) database polling.

## 1. WebRTC Peer-to-Peer Data Channel (Primary Transport)

As of v3.0.0, the primary method of communication between your computer and your phone is a direct WebRTC peer-to-peer data channel.

1. **Local Key Generation:** The CLI generates a cryptographically random 256-bit `encryptionKey` and a random UUID `channelId`.
2. **Signaling:** To establish a WebRTC connection, the CLI and the Mobile App must exchange Session Description Protocol (SDP) offers. The CLI encrypts its SDP offer with the `encryptionKey` and posts it to the Appwrite signaling server.
3. **QR Pairing:** The `encryptionKey` is embedded in the QR Code URL (`https://remote-claude.shaniai.tech/?c=<channelId>&k=<encryptionKey>&t=webrtc`).
4. **Direct Tunnel:** Once the mobile app decrypts the SDP offer and posts an encrypted answer, a direct P2P tunnel is opened. **Your terminal stream flows directly from your computer to your phone.** It never touches the internet or any backend server.

## 2. End-to-End Encryption (Fallback Transport)

If your mobile device is on a restrictive network that blocks WebRTC, or if your phone goes to sleep and drops the P2P connection, the system gracefully falls back to database polling.

All prompt data sent via the database fallback is encrypted with **AES-256-GCM** before it leaves your machine.

1. **Local Encryption:** When Claude pauses for input, the CLI captures the prompt and encrypts it using `crypto.createCipheriv('aes-256-gcm')` on your machine.
2. **Encrypted Sync:** Only the encrypted ciphertext and the `channelId` are sent to Appwrite. **The `encryptionKey` never leaves your machine or touches the backend.**
3. **Browser Decryption:** The PWA uses the browser's Web Crypto API (`window.crypto.subtle`) to decrypt the prompt locally.
4. **Encrypted Reply:** Your response is encrypted with the same key before being sent back to Appwrite.

### What this means in practice

Even if your Appwrite database is public, compromised, or hosted by someone you don't trust, **nobody can read your prompts or inject responses into your terminal**. Without the `encryptionKey` (which only exists in your terminal's memory and your phone's browser session), the stored data is mathematically unreadable.

## 3. Zero-Config Shared Backend

By default, the CLI and the Mobile App connect to a shared, publicly hosted Appwrite backend. 

- **No Setup Required:** You do not need to provide `.env` variables or create your own Appwrite project unless you want to.
- **Database Permissions:** The shared database collection uses `Any` permissions for reading and writing to allow frictionless signaling without user accounts.
- **Why this is safe:** Every single payload (whether it's an SDP offer or a fallback prompt) is E2E encrypted locally *before* transmission. The shared database acts only as a blind relay. Anyone can read the ciphertext, but nobody can decrypt it without the ephemeral `encryptionKey`.

## 4. Self-Hosting (Optional)

If you prefer total data sovereignty, you can deploy your own instance of the frontend and backend. You can override the default endpoints by providing your own `.env` variables (`APPWRITE_PROJECT_ID`, `APPWRITE_ENDPOINT`, etc.).
- Once a WebRTC answer or prompt is consumed, the CLI deletes the encrypted data from the database to keep the queue clean.

## 5. Push Notification Privacy

Push notifications sent via `ntfy.sh` do not contain your actual prompt. They only include a generic alert and the secure URL. No code, project details, or sensitive data is routed through `ntfy.sh` servers.

## 6. Open Source

This project is fully open source. You can review `src/utils/crypto.js`, `src/services/webrtc.js`, and `mobile-app/src/hooks/useWebRTC.js` to verify that encryption and P2P communication is handled purely client-side.
