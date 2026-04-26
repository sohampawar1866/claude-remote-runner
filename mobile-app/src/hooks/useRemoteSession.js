import { useState, useEffect } from 'react';
import { fetchActivePrompts, subscribeToMessages, sendResponse, sendReadyMessage } from '../services/appwrite';

export function useRemoteSession() {
  const [sessionId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('c') || params.get('sessionId');
    if (urlId) {
      localStorage.setItem('remote-claude-session', urlId);
      return urlId;
    }
    return localStorage.getItem('remote-claude-session') || '';
  });
  
  const [encryptionKey] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('k');
    if (urlKey) {
      localStorage.setItem('remote-claude-key', urlKey);
      return urlKey;
    }
    return localStorage.getItem('remote-claude-key') || null;
  });

  const [prompts, setPrompts] = useState([]);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (sessionId) {
      // Fetch initial prompts
      fetchActivePrompts(sessionId, encryptionKey).then(initialPrompts => {
        const disconnectDoc = initialPrompts.find(p => p.type === 'disconnect');
        if (disconnectDoc) {
          setIsDisconnected(true);
          localStorage.removeItem('remote-claude-session');
          localStorage.removeItem('remote-claude-key');
          return;
        }
        setPrompts(initialPrompts.filter(p => p.type === 'prompt').reverse());
      });
      
      // Notify CLI we are connected
      sendReadyMessage(sessionId);
      
      const unsubscribe = subscribeToMessages((payload) => {
        if (payload.sessionId === sessionId && payload.type === 'prompt') {
          setPrompts(prev => [...prev, payload]);
        } else if (payload.sessionId === sessionId && payload.type === 'disconnect') {
          setIsDisconnected(true);
          setPrompts([]);
          localStorage.removeItem('remote-claude-session');
          localStorage.removeItem('remote-claude-key');
        }
      }, encryptionKey);
      
      return () => unsubscribe();
    }
  }, [sessionId, encryptionKey]);

  const sendRemoteResponse = async (text) => {
    if (!text.trim() || !sessionId || isSending) return false;
    
    setIsSending(true);
    const success = await sendResponse(sessionId, text, encryptionKey);
    
    if (success) {
      setTimeout(() => setPrompts([]), 500); 
    }
    
    setIsSending(false);
    return success;
  };

  return {
    sessionId,
    prompts,
    isDisconnected,
    isSending,
    sendRemoteResponse
  };
}
