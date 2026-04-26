import { Client, Databases, Query, ID } from 'appwrite';

const client = new Client();

export const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT; 
export const APPWRITE_PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID;
export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;
export const MESSAGES_COLLECTION_ID = import.meta.env.VITE_APPWRITE_COLLECTION_ID;

if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !DATABASE_ID || !MESSAGES_COLLECTION_ID) {
    console.error('Error: Missing required Appwrite environment variables in .env');
    alert('Missing backend configuration. Please set VITE_APPWRITE_* variables.');
}

client
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

export const databases = new Databases(client);

// Utility functions for WebCrypto AES-GCM
const hexToArrayBuffer = (hex) => {
    return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))).buffer;
};

const getCryptoKey = async (keyHex) => {
    return await window.crypto.subtle.importKey(
        'raw',
        hexToArrayBuffer(keyHex),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
};

export const encryptTextBrowser = async (text, keyHex) => {
    if (!keyHex) return text;
    const key = await getCryptoKey(keyHex);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );
    // Combine IV + EncryptedData (which includes AuthTag)
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedBuffer), iv.length);
    return btoa(String.fromCharCode(...combined));
};

export const decryptTextBrowser = async (base64Payload, keyHex) => {
    if (!keyHex) return base64Payload;
    try {
        const binaryString = atob(base64Payload);
        const combined = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            combined[i] = binaryString.charCodeAt(i);
        }
        if (combined.length < 28) return null; // Fallback to null on garbage
        
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const key = await getCryptoKey(keyHex);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );
        return new TextDecoder().decode(decryptedBuffer);
    } catch {
        return null; // Silent failure on garbage data
    }
};

// To subscribe to realtime events
export const subscribeToMessages = (callback, encryptionKey = null) => {
    return client.subscribe(`databases.${DATABASE_ID}.collections.${MESSAGES_COLLECTION_ID}.documents`, async response => {
        if (response.events.includes('databases.*.collections.*.documents.*.create')) {
            const payload = { ...response.payload };
            if (encryptionKey && payload.content) {
                const decrypted = await decryptTextBrowser(payload.content, encryptionKey);
                if (decrypted !== null) {
                    payload.content = decrypted;
                    callback(payload);
                }
            } else {
                callback(payload);
            }
        }
    });
};

export const sendResponse = async (sessionId, content, encryptionKey = null) => {
    try {
        const safeContent = encryptionKey ? await encryptTextBrowser(content, encryptionKey) : content;
        await databases.createDocument(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            ID.unique(),
            {
                sessionId,
                type: 'response',
                content: safeContent,
                timestamp: new Date().toISOString()
            }
        );
        return true;
    } catch (err) {
        console.error('Failed to send response', err);
        return false;
    }
};

export const sendReadyMessage = async (sessionId) => {
    try {
        await databases.createDocument(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            ID.unique(),
            {
                sessionId,
                type: 'ready',
                content: 'ready',
                timestamp: new Date().toISOString()
            }
        );
        return true;
    } catch {
        return false;
    }
};

export const fetchActivePrompts = async (sessionId, encryptionKey = null) => {
    try {
        const response = await databases.listDocuments(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            [
                Query.equal('sessionId', sessionId),
                Query.orderDesc('$createdAt'),
                Query.limit(10)
            ]
        );
        
        if (!encryptionKey) return response.documents;
        
        // Decrypt all fetched documents and filter out nulls
        const validDocs = [];
        for (const doc of response.documents) {
            const decryptedContent = await decryptTextBrowser(doc.content, encryptionKey);
            if (decryptedContent !== null) {
                validDocs.push({ ...doc, content: decryptedContent });
            }
        }
        return validDocs;
    } catch {
        console.error('Failed to fetch prompts');
        return [];
    }
};

export const fetchWebRTCOffer = async (sessionId, encryptionKey) => {
    try {
        const response = await databases.listDocuments(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            [
                Query.equal('sessionId', sessionId),
                Query.equal('type', 'webrtc_offer'),
                Query.orderDesc('$createdAt'),
                Query.limit(1)
            ]
        );
        
        if (response.documents.length > 0) {
            const doc = response.documents[0];
            const decryptedStr = await decryptTextBrowser(doc.content, encryptionKey);
            if (decryptedStr) {
                // Delete offer to clean up
                await databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, doc.$id).catch(() => {});
                return JSON.parse(decryptedStr);
            }
        }
    } catch {
        console.error('Failed to fetch WebRTC offer');
    }
    return null;
};

export const sendWebRTCAnswer = async (sessionId, answerSdp, encryptionKey) => {
    try {
        const answerStr = JSON.stringify(answerSdp);
        const safeContent = await encryptTextBrowser(answerStr, encryptionKey);
        await databases.createDocument(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            ID.unique(),
            {
                sessionId,
                type: 'webrtc_answer',
                content: safeContent,
                timestamp: new Date().toISOString()
            }
        );
        return true;
    } catch {
        console.error('Failed to send WebRTC answer');
        return false;
    }
};
