import { PeerConnection } from 'node-datachannel';
import qrcode from 'qrcode-terminal';
import { databases, MESSAGES_COLLECTION_ID, DATABASE_ID } from './appwrite.js';
import { encryptText, decryptText } from '../utils/crypto.js';
import { Query } from 'appwrite';

/**
 * Initiates a WebRTC pairing flow with the mobile device.
 * Returns a Promise that resolves with the opened DataChannel.
 */
export async function createWebRTCSession(channelId, encryptionKey, frontendUrl) {
  return new Promise((resolve, reject) => {
    // 1. Initialize Peer Connection
    const peer = new PeerConnection(channelId, {
      iceServers: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
    });

    // 2. Create the primary data channel for terminal data
    const dataChannel = peer.createDataChannel('terminal');
    
    dataChannel.onOpen(() => {
      console.log('\n\x1b[32m🟢 WebRTC Data Channel Opened. Secure P2P connection established!\x1b[39m');
      resolve({ peer, dataChannel });
    });

    dataChannel.onError((err) => {
      console.error('\x1b[31m[WebRTC Error]\x1b[39m', err);
      reject(err);
    });

    // We don't care about incoming data channels in this architecture, 
    // but we listen just in case the phone creates a separate channel for replies.
    peer.onDataChannel((dc) => {
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

        // 6. Poll for the WebRTC Answer
        const answerPoll = setInterval(async () => {
          try {
            const res = await databases.listDocuments(
              DATABASE_ID,
              MESSAGES_COLLECTION_ID,
              [
                Query.equal('sessionId', channelId),
                Query.equal('type', 'webrtc_answer'),
                Query.limit(1)
              ]
            );

            if (res.documents.length > 0) {
              clearInterval(answerPoll);
              const answerDoc = res.documents[0];
              
              // Clean up the signaling data
              await databases.deleteDocument(DATABASE_ID, MESSAGES_COLLECTION_ID, answerDoc.$id).catch(() => {});
              
              const decryptedAnswerStr = decryptText(answerDoc.content, encryptionKey);
              if (decryptedAnswerStr) {
                const answerSdp = JSON.parse(decryptedAnswerStr);
                
                // 7. Set Remote Description -> this triggers the connection
                peer.setRemoteDescription(answerSdp.sdp, answerSdp.type);
                console.log('\x1b[90m[WebRTC] Answer received, establishing P2P tunnel...\x1b[39m');
              }
            }
          } catch (e) {
            // ignore network errors during polling
          }
        }, 2000);
      }
    });

    // Start gathering candidates
    // Note: creating an offer automatically starts gathering in node-datachannel.
    peer.setLocalDescription(); 
  });
}
