# Security Architecture: Claude Remote Runner

Security is a core concern for any tool that intercepts terminal I/O, especially when dealing with AI prompts that may contain source code. Claude Remote Runner is built on a zero-trust model - the backend never sees your data in plaintext.

## 1. End-to-End Encryption (E2E)

All prompt data is encrypted with **AES-256-GCM** before it leaves your machine.

Here is exactly what happens:

1. **Local Key Generation:** The CLI generates a cryptographically random 128-bit `encryptionKey` and a random UUID `channelId`.
2. **Local Encryption:** When Claude pauses for input, the CLI captures the prompt and encrypts it using `crypto.createCipheriv('aes-256-gcm')` on your machine.
3. **Encrypted Sync:** Only the encrypted ciphertext and the `channelId` are sent to Appwrite. **The `encryptionKey` never leaves your machine or touches the backend.**
4. **Push Notification:** A notification is sent via `ntfy.sh` containing a deep link: `https://remote-claude.shaniai.tech/?c=<channelId>&k=<encryptionKey>`. The key is delivered directly to your device through the URL.
5. **Browser Decryption:** The PWA extracts the key from the URL and uses the browser's Web Crypto API (`window.crypto.subtle`) to decrypt the prompt locally.
6. **Encrypted Reply:** Your response is encrypted with the same key before being sent back to Appwrite.

### What this means in practice

Even if your Appwrite database is public, compromised, or hosted by someone you don't trust, **nobody can read your prompts or inject responses into your terminal**. Without the `encryptionKey` (which only exists in your terminal's memory and your phone's browser tab), the stored data is unreadable.

## 2. Zero-Config Shared Backend

By default, the CLI and the Mobile App connect to a shared, publicly hosted Appwrite backend. 

- **No Setup Required:** You do not need to provide `.env` variables or create your own Appwrite project unless you want to.
- **Database Permissions:** The shared database collection uses `Any` permissions for reading and writing to allow frictionless synchronization without user accounts.
- **Why this is safe:** Because every single payload is E2E encrypted locally *before* transmission, the shared database acts only as a blind relay. Anyone can read the ciphertext, but nobody can decrypt it without the ephemeral `encryptionKey` that exists only in your local terminal and your phone's browser. Furthermore, invalid or tampered payloads (spam) are silently discarded by the clients.

## 3. Self-Hosting (Optional)

If you prefer total data sovereignty, you can deploy your own instance of the frontend and backend. You can override the default endpoints by providing your own `.env` variables (`APPWRITE_PROJECT_ID`, `APPWRITE_ENDPOINT`, etc.).
- Once a prompt is answered, the CLI deletes the encrypted data from the database to keep the queue clean.

## 4. Push Notification Privacy

Push notifications sent via `ntfy.sh` do not contain your actual prompt. They only include a generic alert and the secure URL. No code, project details, or sensitive data is routed through `ntfy.sh` servers.

## 5. Open Source

This project is fully open source. You can review `src/utils/crypto.js` and `mobile-app/src/services/appwrite.js` to verify that encryption is handled client-side and that no plaintext data is sent over the network.
