const pty = require('node-pty');
try {
  const p = pty.spawn('/bin/zsh', ['-c', 'echo hello'], { env: process.env });
  p.onData(d => console.log('DATA:', d));
} catch(e) {
  console.log('PTY ERROR:', e.message);
}
