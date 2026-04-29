import fs from 'fs';
const path = './src/services/webrtc.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace('// Silently ignore polling errors', 'console.error("Polling error:", err.message);');
fs.writeFileSync(path, content);
