# Claude Remote Runner - Mobile PWA

This is the frontend Progressive Web App (PWA) for the Claude Remote Runner project. It provides a mobile-friendly interface to receive, decrypt, and respond to prompts from your local Claude Code CLI instance.

## Architecture

This frontend is designed to be completely stateless and relies solely on End-to-End Encryption.
- The `encryptionKey` is parsed directly from the URL.
- Messages pulled from Appwrite are decrypted entirely in the browser using the Web Crypto API (`AES-256-GCM`).
- Responses are encrypted before being pushed back to Appwrite.
- No sensitive data is ever stored persistently in the database or local storage.

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
