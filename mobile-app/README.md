# Remote Runner for Claude - Mobile PWA

> **Disclaimer:** This is an unofficial community project and is not affiliated with, endorsed by, or associated with Anthropic. "Claude" is a trademark of Anthropic.

This is the frontend Progressive Web App (PWA) for the Remote Runner project. It provides a mobile-friendly interface to receive, decrypt, and respond to prompts from your local `claude-code` CLI instance.

## Architecture

This frontend is designed to be highly secure and relies heavily on End-to-End Encryption.
- The `encryptionKey` is parsed directly from the URL.
- Messages pulled from Appwrite via Realtime WebSockets are decrypted entirely in the browser using the Web Crypto API (`AES-256-GCM`).
- Responses and WebRTC answers are encrypted before being pushed back to Appwrite.
- The session credentials are stored transiently in the browser's `localStorage` to allow you to close and reopen the app or add it to your Home Screen. These are automatically wiped the moment the terminal session ends.

## Development

```bash
npm install
npm run dev
```

## Deployment

This app is pre-deployed at **[remote-claude.shaniai.tech](https://remote-claude.shaniai.tech)**. For self-hosting, deploy the `mobile-app` directory to Vercel or Netlify and set the following environment variables:

```bash
VITE_APPWRITE_PROJECT_ID=your_project_id
VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
VITE_APPWRITE_DATABASE_ID=your_db_id
VITE_APPWRITE_COLLECTION_ID=your_collection_id
```

See the root `README.md` for more details on self-hosting and the overall project architecture.
