import { useState, useEffect, useRef } from 'react';
import { fetchWebRTCOffer, sendWebRTCAnswer } from '../services/appwrite';

export function useWebRTC(sessionId, encryptionKey) {
  const [isConnected, setIsConnected] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState('');
  const dataChannelRef = useRef(null);
  const peerConnectionRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isWebRTC = params.get('t') === 'webrtc';
    
    if (!sessionId || !isWebRTC) return;

    let isMounted = true;

    async function initWebRTC() {
      try {
        const offer = await fetchWebRTCOffer(sessionId, encryptionKey);
        if (!offer || !isMounted) return;

        const peer = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        });
        peerConnectionRef.current = peer;

        // Listen for the data channel from the CLI
        peer.ondatachannel = (event) => {
          const channel = event.channel;
          dataChannelRef.current = channel;
          
          channel.onopen = () => {
            if (isMounted) setIsConnected(true);
          };
          
          channel.onmessage = (e) => {
            if (isMounted) {
              setTerminalOutput(prev => prev + e.data);
            }
          };
          
          channel.onclose = () => {
            if (isMounted) setIsConnected(false);
          };
        };

        // Wait for ICE gathering to complete before answering
        peer.onicegatheringstatechange = async () => {
          if (peer.iceGatheringState === 'complete' && isMounted) {
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
    }

    initWebRTC();

    return () => {
      isMounted = false;
      if (dataChannelRef.current) dataChannelRef.current.close();
      if (peerConnectionRef.current) peerConnectionRef.current.close();
    };
  }, [sessionId, encryptionKey]);

  const sendWebRTCMessage = (text) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(text);
      return true;
    }
    return false;
  };

  return {
    isWebRTCConnected: isConnected,
    terminalOutput,
    sendWebRTCMessage
  };
}
