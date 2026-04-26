import crypto from 'crypto';

export function encryptText(text, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = cipher.update(text, 'utf8');
  const final = cipher.final();
  const authTag = cipher.getAuthTag();
  // WebCrypto format: IV + Ciphertext + AuthTag
  const payload = Buffer.concat([iv, encrypted, final, authTag]);
  return payload.toString('base64');
}

export function decryptText(payloadBase64, keyHex) {
  try {
    const payload = Buffer.from(payloadBase64, 'base64');
    if (payload.length < 28) return null; // Too short, probably garbage
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(payload.length - 16);
    const encrypted = payload.subarray(12, payload.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null; // Silent failure on garbage data
  }
}
