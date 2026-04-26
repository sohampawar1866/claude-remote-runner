// src/services/ntfy.js

export async function sendNtfyAlert(topic, title, message, channelId, encryptionKey, frontendUrl, isBackendConfigured) {
  if (!isBackendConfigured) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: message,
      headers: {
        'Title': title,
        'Tags': 'robot',
        'Priority': 'default',
        'Click': `${frontendUrl}/?c=${channelId}&k=${encryptionKey}`
      }
    });
  } catch (err) {
    console.error('\x1b[31m[remote-claude] Failed to send ntfy alert:\x1b[39m', err.message);
  }
}
