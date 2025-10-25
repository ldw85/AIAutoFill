const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CipherPayload {
  iv: string;
  data: string;
}

export const PBKDF2_ITERATIONS = 310_000;
export const KEY_LENGTH = 256;
export const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const VERIFICATION_TEXT = 'AIAutoFill::MASTER::VERIFICATION::v1';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeBytes(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function decodeBytes(serialised: string): Uint8Array {
  return fromBase64(serialised);
}

export function generateSalt(length: number = SALT_LENGTH): Uint8Array {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return salt;
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const passphraseBytes = encoder.encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey('raw', passphraseBytes, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson<T>(payload: T, key: CryptoKey): Promise<CipherPayload> {
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);
  const data = encoder.encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    data
  );
  return {
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipherBuffer))
  };
}

export async function decryptJson<T>(cipher: CipherPayload, key: CryptoKey): Promise<T> {
  const iv = decodeBytes(cipher.iv);
  const data = decodeBytes(cipher.data);
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    data
  );
  const decoded = decoder.decode(plainBuffer);
  return JSON.parse(decoded) as T;
}

export async function createVerification(key: CryptoKey): Promise<CipherPayload> {
  return encryptJson(VERIFICATION_TEXT, key);
}

export async function verifyKey(key: CryptoKey, verification: CipherPayload): Promise<boolean> {
  try {
    const decoded = await decryptJson<string>(verification, key);
    return decoded === VERIFICATION_TEXT;
  } catch {
    return false;
  }
}
