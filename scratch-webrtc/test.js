const { RTCPeerConnection } = require('werift-webrtc');

async function run() {
  console.log('--- Starting WebRTC Test ---');

  // 1. Create Peer A (The CLI)
  const peerA = new RTCPeerConnection();
  
  // Create a Data Channel
  const channelA = peerA.createDataChannel('chat');
  
  channelA.onOpen = () => {
    console.log('Peer A: Data channel opened!');
    channelA.send('Hello from Peer A!');
  };

  channelA.onMessage = (data) => {
    console.log('Peer A received:', data);
  };

  // 2. Create Peer B (The Mobile App)
  const peerB = new RTCPeerConnection();
  
  peerB.onDataChannel = (channelB) => {
    console.log('Peer B: Data channel received!');
    channelB.onOpen = () => {
      console.log('Peer B: Data channel opened!');
      channelB.send('Hello from Peer B!');
    };
    channelB.onMessage = (data) => {
      console.log('Peer B received:', data);
      
      // End test after successful exchange
      setTimeout(() => {
        console.log('--- Test Passed ---');
        process.exit(0);
      }, 500);
    };
  };

  // 3. Signaling (Exchange ICE candidates automatically in this local test via promise)
  // Usually this goes over Appwrite
  
  console.log('Creating Offer from Peer A...');
  // Exchange ICE candidates manually
  peerA.onicecandidate = ({ candidate }) => {
    if (candidate) peerB.addIceCandidate(candidate);
  };
  peerB.onicecandidate = ({ candidate }) => {
    if (candidate) peerA.addIceCandidate(candidate);
  };

  console.log('Creating Offer from Peer A...');
  const offer = await peerA.createOffer();
  await peerA.setLocalDescription(offer);
  
  console.log('Setting Remote Description on Peer B...');
  await peerB.setRemoteDescription(peerA.localDescription);
  
  console.log('Creating Answer from Peer B...');
  const answer = await peerB.createAnswer();
  await peerB.setLocalDescription(answer);

  console.log('Setting Remote Description on Peer A...');
  await peerA.setRemoteDescription(peerB.localDescription);
}

run().catch(console.error);
