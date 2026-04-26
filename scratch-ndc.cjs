

async function run() {
  console.log('Creating Peer A...');
  const peerA = new PeerConnection('peerA', { iceServers: ['stun:stun.l.google.com:19302'] });

  peerA.onLocalDescription((sdp, type) => {
    console.log(`Peer A Local Description (${type}):`);
    console.log(sdp);
  });

  peerA.onLocalCandidate((candidate, mid) => {
    console.log(`Peer A Candidate:`, candidate);
  });

  const dcA = peerA.createDataChannel('chat');
  dcA.onOpen(() => {
    console.log('Data Channel A opened');
    dcA.sendMessage('Hello from A');
  });

  dcA.onMessage((msg) => {
    console.log('Peer A received:', msg.toString());
    process.exit(0);
  });

  console.log('Creating Peer B...');
  const peerB = new PeerConnection('peerB', { iceServers: ['stun:stun.l.google.com:19302'] });

  peerB.onDataChannel((dcB) => {
    console.log('Peer B received data channel');
    dcB.onOpen(() => {
      console.log('Data Channel B opened');
      dcB.sendMessage('Hello from B');
    });
    dcB.onMessage((msg) => {
      console.log('Peer B received:', msg.toString());
    });
  });

  // To simulate signaling without network:
  peerA.onLocalDescription((sdp, type) => {
    peerB.setRemoteDescription(sdp, type);
  });
  peerB.onLocalDescription((sdp, type) => {
    peerA.setRemoteDescription(sdp, type);
  });
  peerA.onLocalCandidate((candidate, mid) => {
    peerB.addRemoteCandidate(candidate, mid);
  });
  peerB.onLocalCandidate((candidate, mid) => {
    peerA.addRemoteCandidate(candidate, mid);
  });

}

run().catch(console.error);
