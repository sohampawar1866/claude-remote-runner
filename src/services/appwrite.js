import { Client, Databases, ID, Query } from 'appwrite';
import dotenv from 'dotenv';
import defaults from '../config/defaults.js';
import { encryptText, decryptText } from '../utils/crypto.js';

// Load environment variables
dotenv.config();

export const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || defaults.APPWRITE_ENDPOINT;
export const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || defaults.APPWRITE_PROJECT_ID; 
export const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || defaults.DATABASE_ID; 
export const MESSAGES_COLLECTION_ID = process.env.APPWRITE_COLLECTION_ID || defaults.MESSAGES_COLLECTION_ID; 
export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://remote-claude.shaniai.tech';

export let isBackendConfigured = true;

if (!APPWRITE_PROJECT_ID || !DATABASE_ID || !MESSAGES_COLLECTION_ID || !FRONTEND_URL) {
    console.error('\x1b[33m[remote-claude] Warning: Missing required environment variables.\x1b[39m');
    console.error('Remote functionality is disabled. You can still use Claude locally, but remote prompts will be ignored.');
    console.error('To enable remote sync, please ensure APPWRITE_PROJECT_ID, APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_ID, and FRONTEND_URL are set in your .env or environment.\n');
    isBackendConfigured = false;
}

const client = new Client();

if (isBackendConfigured) {
    client
        .setEndpoint(APPWRITE_ENDPOINT)
        .setProject(APPWRITE_PROJECT_ID);
}

export const databases = isBackendConfigured ? new Databases(client) : null;

export async function logPromptToAppwrite(channelId, promptText, encryptionKey, type = 'prompt') {
  if (!isBackendConfigured) return;
  try {
    const safeContent = encryptionKey ? encryptText(promptText, encryptionKey) : promptText;
    await databases.createDocument(
      DATABASE_ID,
      MESSAGES_COLLECTION_ID,
      ID.unique(),
      {
        sessionId: channelId, // We use the same Appwrite attribute 'sessionId' to store channelId
        type: type,
        content: safeContent,
        timestamp: new Date().toISOString()
      }
    );
  } catch (err) {
    console.error('\x1b[31m[remote-claude] Appwrite Error:\x1b[39m', err.message);
  }
}

/**
 * Subscribe to the messages collection via Appwrite Realtime WebSockets.
 * Replaces setInterval-based polling for dramatically lower latency and battery usage.
 * 
 * @param {Function} callback - Called with the raw document payload on every new document.
 * @returns {Function} Unsubscribe function.
 */
export function subscribeToCollection(callback) {
  if (!isBackendConfigured) return () => {};
  return client.subscribe(
    `databases.${DATABASE_ID}.collections.${MESSAGES_COLLECTION_ID}.documents`,
    (response) => {
      if (response.events.some(e => e.includes('.create'))) {
        callback(response.payload);
      }
    }
  );
}

/**
 * Subscribe to response messages for a specific channel via Appwrite Realtime.
 * When a response arrives, it is decrypted, the document is deleted, and the callback fires.
 * 
 * @param {string} channelId - Session channel to listen on.
 * @param {string} encryptionKey - AES-256 hex key for decryption.
 * @param {Function} onResponse - Called with the decrypted response text.
 * @returns {Function} Unsubscribe function.
 */
export function subscribeToResponses(channelId, encryptionKey, onResponse) {
  if (!isBackendConfigured) return () => {};
  return subscribeToCollection(async (payload) => {
    if (payload.sessionId === channelId && payload.type === 'response') {
      // Delete from queue immediately
      await databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, payload.$id).catch(() => {});
      
      const decrypted = encryptionKey ? decryptText(payload.content, encryptionKey) : payload.content;
      if (decrypted !== null) {
        onResponse(decrypted);
      }
    }
  });
}

export async function pollForPairing(channelId) {
  if (!isBackendConfigured) return;
  const pairInterval = setInterval(async () => {
    try {
      const response = await databases.listDocuments(
        DATABASE_ID,
        MESSAGES_COLLECTION_ID,
        [
          Query.equal('sessionId', channelId),
          Query.equal('type', 'ready'),
          Query.limit(1)
        ]
      );
      if (response.documents.length > 0) {
        clearInterval(pairInterval);
        console.log('\n\x1b[32m🟢 Paired with mobile device!\x1b[39m');
        await databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, response.documents[0].$id);
      }
    } catch {
      // ignore
    }
  }, 2000);
}
