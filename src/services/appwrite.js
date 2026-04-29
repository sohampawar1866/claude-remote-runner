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

export async function fetchResponseFromAppwrite(channelId, encryptionKey) {
  if (!isBackendConfigured) return null;
  try {
    const response = await databases.listDocuments(
      DATABASE_ID,
      MESSAGES_COLLECTION_ID,
      [
        Query.equal('sessionId', channelId),
        Query.equal('type', 'response'),
        Query.orderAsc('$createdAt'),
        Query.limit(10) // fetch up to 10 in case of spam
      ]
    );
    
    if (response.documents.length > 0) {
      let validResponse = null;
      
      for (const doc of response.documents) {
        // Always delete to clear queue (including garbage/spam)
        await databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, doc.$id).catch(() => {});
        
        if (!validResponse) {
          const decrypted = encryptionKey ? decryptText(doc.content, encryptionKey) : doc.content;
          if (decrypted !== null) {
            validResponse = decrypted;
          }
        }
      }
      
      return validResponse;
    }
  } catch {
    // Fail silently during polling
  }
  return null;
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
