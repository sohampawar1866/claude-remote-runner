// src/defaults.js
// Public defaults pointing to the hosted backend.
// Safe to commit - no secrets here.
// Self-hosters: override via .env

export default {
  APPWRITE_ENDPOINT: 'https://sfo.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: 'claude-remote-runner',
  DATABASE_ID: 'remote_runner',
  MESSAGES_COLLECTION_ID: 'messages'
};
