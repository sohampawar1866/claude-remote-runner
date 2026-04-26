import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchWebRTCOffer, sendWebRTCAnswer } from '../services/appwrite';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/**
 * Calculate the terminal grid dimensions based on the current viewport width.
 * Assumes a monospace font at ~8px per character.
 */
function calculateTerminalDimensions() {
  const charWidth = 8;
  const charHeight = 16;
  const padding = 24; // CSS padding on the terminal container
  const cols = Math.max(40, Math.floor((window.innerWidth - padding * 2) / charWidth));
  const rows = Math.max(12, Math.floor((window.innerHeight * 0.6) / charHeight));
  return { cols, rows };
}

export function useWebRTC(sessionId, encryptionKey, isWebRTCSession) {
  const [isConnected, setIsConnected] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState('');
  const dataChannelRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const isMountedRef = useRef(true);

  /**
   * Core WebRTC initialization — extracted so it can be called on first load
   * AND on reconnection after a visibility change (Phase 4).
   */
  const initWebRTC = useCallback(async () => {
    if (!sessionId || !isWebRTCSession) return;

    // Tear down any existing connection before rebuilding
    if (dataChannelRef.current) { try { dataChannelRef.current.close(); } catch { /* intentional */ } }
    if (peerConnectionRef.current) { try { peerConnectionRef.current.close(); } catch { /* intentional */ } }

    try {
      const offer = await fetchWebRTCOffer(sessionId, encryptionKey);
      if (!offer || !isMountedRef.current) return;

      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionRef.current = peer;

      // Listen for the data channel from the CLI
      peer.ondatachannel = (event) => {
        const channel = event.channel;
        dataChannelRef.current = channel;
        
        channel.onopen = () => {
          if (isMountedRef.current) setIsConnected(true);

          // Phase 3: Send our terminal dimensions so the CLI can resize the PTY
          const dims = calculateTerminalDimensions();
          channel.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        };
        
        channel.onmessage = (e) => {
          if (!isMountedRef.current) return;

          // Phase 3: Parse JSON packets from the CLI
          try {
            const packet = JSON.parse(e.data);
            switch (packet.type) {
              case 'stream':
                setTerminalOutput(prev => prev + packet.data);
                break;
              case 'history':
                // History burst from the CLI — prepend to existing output
                setTerminalOutput(prev => packet.data + prev);
                break;
              default:
                break;
            }
          } catch {
            // Fallback: if the CLI sends raw text (backward compat), append directly
            setTerminalOutput(prev => prev + e.data);
          }
        };
        
        channel.onclose = () => {
          if (isMountedRef.current) setIsConnected(false);
        };
      };

      // Wait for ICE gathering to complete before answering
      peer.onicegatheringstatechange = async () => {
        if (peer.iceGatheringState === 'complete' && isMountedRef.current) {
          const answer = peer.localDescription;
          await sendWebRTCAnswer(sessionId, answer, encryptionKey);
        }
      };

      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

    } catch (err) {
      console.error('WebRTC initialization failed:', err);
    }
  }, [sessionId, encryptionKey, isWebRTCSession]);

  // ── Initial connection ──────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    initWebRTC();

    return () => {
      isMountedRef.current = false;
      if (dataChannelRef.current) { try { dataChannelRef.current.close(); } catch { /* intentional */ } }
      if (peerConnectionRef.current) { try { peerConnectionRef.current.close(); } catch { /* intentional */ } }
    };
  }, [initWebRTC]);

  // ── Phase 4: Reconnect on visibility change ─────────────────────
  // When the phone wakes up and the app returns to the foreground,
  // check if the DataChannel died and automatically renegotiate.
  useEffect(() => {
    if (!isWebRTCSession) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const channel = dataChannelRef.current;
        if (!channel || channel.readyState === 'closed' || channel.readyState === 'closing') {
          console.log('[WebRTC] App foregrounded — data channel dead, attempting reconnect...');
          setIsConnected(false);
          initWebRTC();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isWebRTCSession, initWebRTC]);

  // ── Phase 3: Handle window resize → send new PTY dimensions ────
  useEffect(() => {
    if (!isWebRTCSession) return;

    const handleResize = () => {
      const channel = dataChannelRef.current;
      if (channel && channel.readyState === 'open') {
        const dims = calculateTerminalDimensions();
        channel.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    window.addEventListener('resize', handleResize);
    // Also handle orientation changes on mobile
    window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isWebRTCSession]);

  const sendWebRTCMessage = useCallback((text) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(text);
      return true;
    }
    return false;
  }, []);

  return {
    isWebRTCConnected: isConnected,
    terminalOutput,
    sendWebRTCMessage,
    reconnect: initWebRTC,
  };
}
