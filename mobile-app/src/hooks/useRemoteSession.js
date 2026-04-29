import { useState, useEffect, useCallback } from 'react';
import { fetchActivePrompts, subscribeToMessages, sendResponse, sendReadyMessage } from '../services/appwrite';

const STORAGE_KEYS = {
  SESSION: 'remote-claude-session',
  KEY: 'remote-claude-key',
  WEBRTC: 'remote-claude-webrtc',
  NTFY: 'remote-claude-ntfy',
};

/**
 * Reads session credentials from URL params first, then falls back to localStorage.
 * This ensures the PWA works correctly when launched from the Home Screen (iOS strips URL params).
 */
function resolveCredentials() {
  const params = new URLSearchParams(window.location.search);

  const urlId = params.get('c') || params.get('sessionId');
  const urlKey = params.get('k');
  const urlWebRTC = params.get('t') === 'webrtc';
  const urlNtfy = params.get('n');

  // If the URL contains fresh credentials, persist them immediately
  if (urlId && urlKey) {
    localStorage.setItem(STORAGE_KEYS.SESSION, urlId);
    localStorage.setItem(STORAGE_KEYS.KEY, urlKey);
    localStorage.setItem(STORAGE_KEYS.WEBRTC, urlWebRTC ? 'true' : 'false');
    if (urlNtfy) {
      localStorage.setItem(STORAGE_KEYS.NTFY, urlNtfy);
    }

    // Clean URL after saving (prevents accidental key leakage via screenshots / browser history)
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return { sessionId: urlId, encryptionKey: urlKey, isWebRTCSession: urlWebRTC, ntfyTopic: urlNtfy };
  }

  // Fallback: resurrect from localStorage (PWA Home Screen launch)
  return {
    sessionId: localStorage.getItem(STORAGE_KEYS.SESSION) || '',
    encryptionKey: localStorage.getItem(STORAGE_KEYS.KEY) || null,
    isWebRTCSession: localStorage.getItem(STORAGE_KEYS.WEBRTC) === 'true',
    ntfyTopic: localStorage.getItem(STORAGE_KEYS.NTFY) || null,
  };
}

export function useRemoteSession() {
  const [credentials] = useState(resolveCredentials);
  const { sessionId, encryptionKey, isWebRTCSession, ntfyTopic } = credentials;

  const [prompts, setPrompts] = useState([]);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    // Fetch initial prompts
    fetchActivePrompts(sessionId, encryptionKey).then(initialPrompts => {
      const disconnectDoc = initialPrompts.find(p => p.type === 'disconnect');
      if (disconnectDoc) {
        setIsDisconnected(true);
        clearStorage();
        return;
      }
      setPrompts(initialPrompts.filter(p => p.type === 'prompt').reverse());
    });
    
    // Notify CLI we are connected
    sendReadyMessage(sessionId);
    
    // Subscribe to realtime messages via Appwrite WebSockets (Phase 2)
    const unsubscribe = subscribeToMessages((payload) => {
      if (payload.sessionId === sessionId && payload.type === 'prompt') {
        setPrompts(prev => [...prev, payload]);
      } else if (payload.sessionId === sessionId && payload.type === 'disconnect') {
        setIsDisconnected(true);
        setPrompts([]);
        clearStorage();
      }
    }, encryptionKey);
    
    return () => unsubscribe();
  }, [sessionId, encryptionKey]);

  const sendRemoteResponse = useCallback(async (text) => {
    if (!text.trim() || !sessionId || isSending) return false;
    
    setIsSending(true);
    const success = await sendResponse(sessionId, text, encryptionKey);
    
    if (success) {
      setTimeout(() => setPrompts([]), 500); 
    }
    
    setIsSending(false);
    return success;
  }, [sessionId, encryptionKey, isSending]);

  const disconnect = useCallback(() => {
    clearStorage();
    setIsDisconnected(true);
    setPrompts([]);
  }, []);

  return {
    sessionId,
    encryptionKey,
    isWebRTCSession,
    ntfyTopic,
    prompts,
    isDisconnected,
    isSending,
    sendRemoteResponse,
    disconnect,
  };
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  localStorage.removeItem(STORAGE_KEYS.KEY);
  localStorage.removeItem(STORAGE_KEYS.WEBRTC);
  localStorage.removeItem(STORAGE_KEYS.NTFY);
}
