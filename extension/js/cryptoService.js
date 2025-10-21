import { bytesFromString, stringFromBytes, randomBytes, bytesToBase64, base64ToBytes } from './utils.js';

const GCM_IV_BYTES = 12;

async function getKeyMaterial(passphrase) {
  const enc = bytesFromString(passphrase);
  return crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey']);
}

export async function deriveAesGcmKey(passphrase, saltBase64, iterations = 250000, hash = 'SHA-256') {
  const keyMaterial = await getKeyMaterial(passphrase);
  const salt = base64ToBytes(saltBase64);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return key;
}

export async function encryptString(key, plaintext) {
  const iv = randomBytes(GCM_IV_BYTES);
  const encoded = bytesFromString(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const ciphertext = new Uint8Array(ciphertextBuf);
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

export async function decryptString(key, ivBase64, ciphertextBase64) {
  const iv = base64ToBytes(ivBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);
  const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return stringFromBytes(new Uint8Array(plaintextBuf));
}
