import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import dotenv from 'dotenv';
import { Client, Databases, ID } from 'node-appwrite';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') }); // Resolve relative to this file, not CWD

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://sfo.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID;
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY; // We'll need a server API key
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const MESSAGES_COLLECTION_ID = process.env.APPWRITE_COLLECTION_ID;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'RemoteClaudeBot';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

if (APPWRITE_API_KEY) {
    client.setKey(APPWRITE_API_KEY);
}

const databases = new Databases(client);

// In-memory mappings
// sessionId -> { chatId, encryptionKey }
const sessions = new Map();

// Helper to encrypt text (must match CLI crypto.js)
function encryptText(text, keyHex) {
    if (!text || !keyHex) return null;
    try {
      const key = Buffer.from(keyHex, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption failed:', error);
      return null;
    }
  }

// Telegram command handling
bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const sessionId = match[1]; // Just the sessionId now (pre-registered via /register-session)

    // Look up pre-registered session to get the encryption key
    const existing = sessions.get(sessionId);
    if (!existing) {
        bot.sendMessage(chatId, '❌ Session not found. Make sure remote-claude is running.');
        return;
    }

    // Update with the Telegram chat_id
    sessions.set(sessionId, { ...existing, chatId });

    bot.sendMessage(chatId, `🔗 Connected to session. Working...`);
    
    // Write 'ready' to Appwrite so CLI knows we paired
    try {
        await databases.createDocument(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            ID.unique(),
            {
              sessionId: sessionId,
              type: 'ready',
              content: 'paired',
              timestamp: new Date().toISOString()
            }
        );
    } catch (e) {
        console.error('Failed to notify CLI of pairing', e);
    }
});

// Pre-registration endpoint: CLI calls this to store sessionId + encryptionKey
// BEFORE generating the deep link
app.post('/register-session', (req, res) => {
    const { sessionId, encryptionKey } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    sessions.set(sessionId, { chatId: null, encryptionKey: encryptionKey || null });
    res.json({ success: true });
});

// Callback queries (Button taps)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    let sessionId, action;
    try {
        const parsed = JSON.parse(data);
        sessionId = parsed.s;
        action = parsed.a;
    } catch (e) {
        return bot.answerCallbackQuery(query.id, { text: 'Invalid data' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
        return bot.answerCallbackQuery(query.id, { text: 'Session not found' });
    }

    bot.answerCallbackQuery(query.id);

    // Update message UI
    bot.editMessageText(`✅ Executing response...`, {
        chat_id: chatId,
        message_id: messageId
    });

    let responseText = '';
    if (action === 'yes') responseText = 'yes';
    else if (action === 'no') responseText = 'no';
    else if (action === 'wait') responseText = 'wait';

    // Push back to CLI via Appwrite
    let safeContent = session.encryptionKey 
        ? encryptText(responseText, session.encryptionKey) 
        : responseText;
    
    if (safeContent === null) {
        bot.sendMessage(chatId, '❌ Encryption failed. Could not send response.');
        return;
    }

    try {
        await databases.createDocument(
            DATABASE_ID,
            MESSAGES_COLLECTION_ID,
            ID.unique(),
            {
                sessionId: sessionId,
                type: 'response',
                content: safeContent,
                timestamp: new Date().toISOString()
            }
        );
        bot.sendMessage(chatId, `Sent '${responseText}' to Claude.`);
    } catch (e) {
        console.error('Failed to send response to CLI', e);
        bot.sendMessage(chatId, `Failed to send response to Claude.`);
    }
});

// API Endpoints for CLI
app.post('/notify-pause', (req, res) => {
    const { sessionId, context } = req.body;
    const session = sessions.get(sessionId);
    
    if (session) {
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Yes', callback_data: JSON.stringify({ s: sessionId, a: 'yes' }) },
                        { text: '❌ No', callback_data: JSON.stringify({ s: sessionId, a: 'no' }) }
                    ],
                    [
                        { text: '⏸️ Wait 10 min', callback_data: JSON.stringify({ s: sessionId, a: 'wait' }) },
                        { text: '🖥️ Open Terminal', url: `https://t.me/${BOT_USERNAME}/terminal?startapp=${sessionId}_key_${session.encryptionKey || ''}` }
                    ]
                ]
            }
        };
        bot.sendMessage(session.chatId, `🤖 Claude is paused\n\n${context || 'Wants to execute a command'}`, opts);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

app.post('/notify-status', (req, res) => {
    const { sessionId, message } = req.body;
    const session = sessions.get(sessionId);
    if (session) {
        bot.sendMessage(session.chatId, `ℹ️ ${message}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

app.post('/notify-end', (req, res) => {
    const { sessionId, message, error } = req.body;
    const session = sessions.get(sessionId);
    if (session) {
        const prefix = error ? '⚠️' : '✅';
        bot.sendMessage(session.chatId, `${prefix} ${message || 'Session ended'}`);
        // sessions.delete(sessionId);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

app.listen(PORT, () => {
    console.log(`Telegram Backend running on port ${PORT}`);
});
