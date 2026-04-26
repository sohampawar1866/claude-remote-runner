import { PeerConnection } from 'node-datachannel';
import qrcode from 'qrcode-terminal';
import { databases, MESSAGES_COLLECTION_ID, DATABASE_ID, subscribeToCollection } from './appwrite.js';
import { encryptText, decryptText } from '../utils/crypto.js';

/**
 * Initiates a WebRTC pairing flow with the mobile device.
 * Returns a Promise that resolves with the opened DataChannel, plus
 * a helper object for managing the session lifecycle.
 *
 * @param {string} channelId - Unique session identifier.
 * @param {string} encryptionKey - AES-256 hex key for signaling encryption.
 * @param {string} frontendUrl - Base URL for the mobile PWA.
 * @param {Object} [hooks] - Optional lifecycle hooks.
 * @param {Function} [hooks.onMessage] - Called when the mobile sends a message (e.g. user input).
 * @param {Function} [hooks.onResize] - Called when the mobile requests a PTY resize. Receives { cols, rows }.
 * @param {Function} [hooks.getBuffer] - Called to get the current terminal buffer for history burst.
 * @param {Object} [hooks.ptyProcess] - The node-pty process, used for resizing.
 */
export async function createWebRTCSession(channelId, encryptionKey, frontendUrl, hooks = {}) {
  return new Promise((resolve, reject) => {
    // 1. Initialize Peer Connection
    const peer = new PeerConnection(channelId, {
      iceServers: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
    });

    // 2. Create the primary data channel for terminal data
    const dataChannel = peer.createDataChannel('terminal');
    
    dataChannel.onOpen(() => {
      console.log('\n\x1b[32m🟢 WebRTC Data Channel Opened. Secure P2P connection established!\x1b[39m');

      // Phase 3: Send a history burst so late joiners see context
      if (hooks.getBuffer) {
        try {
          const buffer = hooks.getBuffer();
          if (buffer && buffer.length > 0) {
            dataChannel.sendMessage(JSON.stringify({ type: 'history', data: buffer }));
          }
        } catch {
          // ignore history burst failures
        }
      }

      resolve({ peer, dataChannel });
    });

    dataChannel.onError((err) => {
      console.error('\x1b[31m[WebRTC Error]\x1b[39m', err);
      reject(err);
    });

    // Phase 3: Handle incoming messages from the mobile app (JSON protocol)
    dataChannel.onMessage((msg) => {
      const text = msg.toString();
      try {
        const packet = JSON.parse(text);
        switch (packet.type) {
          case 'input':
            if (hooks.onMessage) hooks.onMessage(packet.data);
            break;
          case 'resize':
            if (hooks.onResize) hooks.onResize(packet);
            if (hooks.ptyProcess) {
              hooks.ptyProcess.resize(packet.cols, packet.rows);
            }
            break;
          default:
            // Unknown packet type — treat as raw input for backward compat
            if (hooks.onMessage) hooks.onMessage(text);
            break;
        }
      } catch {
        // Fallback: raw text (backward compat with older mobile clients)
        if (hooks.onMessage) hooks.onMessage(text);
      }
    });

    // We don't care about incoming data channels in this architecture, 
    // but we listen just in case the phone creates a separate channel for replies.
    peer.onDataChannel(() => {
      // If mobile initiates a channel
    });

    // 3. Wait for ICE gathering to complete so we can send one unified SDP Offer
    peer.onGatheringStateChange(async (state) => {
      if (state === 'complete') {
        const offerSdp = peer.localDescription();
        
        // Encrypt the SDP to ensure the signaling path is zero-trust
        const encryptedOffer = encryptText(JSON.stringify(offerSdp), encryptionKey);
        
        // 4. Log the offer to Appwrite as the signaling server
        await databases.createDocument(
          DATABASE_ID,
          MESSAGES_COLLECTION_ID,
          'unique()',
          {
            sessionId: channelId,
            type: 'webrtc_offer',
            content: encryptedOffer,
            timestamp: new Date().toISOString()
          }
        ).catch(err => {
          console.error('Failed to post WebRTC offer to Appwrite:', err.message);
          reject(err);
        });

        // 5. Display the QR Code for the user
        const pairUrl = `${frontendUrl}/?c=${channelId}&k=${encryptionKey}&t=webrtc`;
        console.log('\n\x1b[36m📱 Scan this QR code to connect directly via WebRTC:\x1b[39m');
        qrcode.generate(pairUrl, { small: true });
        console.log(`\nOr click here: \x1b[4m${pairUrl}\x1b[24m\n`);
        console.log('\x1b[90mWaiting for mobile device to answer...\x1b[39m');

        // 6. Listen for WebRTC Answer via Appwrite Realtime (Phase 2)
        const unsubscribe = subscribeToCollection((payload) => {
          if (payload.sessionId === channelId && payload.type === 'webrtc_answer') {
            unsubscribe();
            
            // Clean up the signaling data
            databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, payload.$id).catch(() => {});
            
            const decryptedAnswerStr = decryptText(payload.content, encryptionKey);
            if (decryptedAnswerStr) {
              const answerSdp = JSON.parse(decryptedAnswerStr);
              
              // 7. Set Remote Description -> this triggers the connection
              peer.setRemoteDescription(answerSdp.sdp, answerSdp.type);
              console.log('\x1b[90m[WebRTC] Answer received, establishing P2P tunnel...\x1b[39m');
            }
          }
        });
      }
    });

    // Start gathering candidates
    // Note: creating an offer automatically starts gathering in node-datachannel.
    peer.setLocalDescription(); 
  });
}

/**
 * Sends a JSON-wrapped terminal stream chunk over the data channel.
 * @param {Object} dataChannel - The open WebRTC DataChannel.
 * @param {string} rawData - Raw ANSI terminal data.
 */
export function sendTerminalChunk(dataChannel, rawData) {
  if (dataChannel && dataChannel.isOpen()) {
    try {
      dataChannel.sendMessage(JSON.stringify({ type: 'stream', data: rawData }));
    } catch {
      // ignore send failures on closing channels
    }
  }
}
