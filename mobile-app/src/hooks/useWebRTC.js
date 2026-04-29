import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchWebRTCOffer, sendWebRTCAnswer } from '../services/appwrite';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export function useWebRTC(sessionId, encryptionKey, isWebRTCSession) {
  const [isConnected, setIsConnected] = useState(false);
  // dataChannel as STATE so React re-renders when it arrives
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnectionRef = useRef(null);
  const isMountedRef = useRef(true);

  /**
   * Core WebRTC initialization — extracted so it can be called on first load
   * AND on reconnection after a visibility change (Phase 4).
   */
  const initWebRTC = useCallback(async () => {
    if (!sessionId || !isWebRTCSession) return;

    // Tear down any existing connection before rebuilding
    if (peerConnectionRef.current) { try { peerConnectionRef.current.close(); } catch { /* intentional */ } }

    try {
      const offer = await fetchWebRTCOffer(sessionId, encryptionKey);
      if (!offer || !isMountedRef.current) return;

      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionRef.current = peer;

      // Listen for the data channel from the CLI
      peer.ondatachannel = (event) => {
        const channel = event.channel;
        
        channel.onopen = () => {
          if (isMountedRef.current) {
            setDataChannel(channel);
            setIsConnected(true);
          }
        };
        
        channel.onclose = () => {
          if (isMountedRef.current) {
            setDataChannel(null);
            setIsConnected(false);
          }
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
      if (peerConnectionRef.current) { try { peerConnectionRef.current.close(); } catch { /* intentional */ } }
    };
  }, [initWebRTC]);

  // ── Phase 4: Reconnect on visibility change ─────────────────────
  useEffect(() => {
    if (!isWebRTCSession) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!dataChannel || dataChannel.readyState === 'closed' || dataChannel.readyState === 'closing') {
          console.log('[WebRTC] App foregrounded — data channel dead, attempting reconnect...');
          setIsConnected(false);
          setDataChannel(null);
          initWebRTC();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isWebRTCSession, initWebRTC, dataChannel]);

  const sendWebRTCMessage = useCallback((text) => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(text);
      return true;
    }
    return false;
  }, [dataChannel]);

  return {
    isWebRTCConnected: isConnected,
    dataChannel,
    sendWebRTCMessage,
    reconnect: initWebRTC,
  };
}
