/*
  Encrypted storage utilities for the extension (browser content script/options/popup)
  - AES-GCM with PBKDF2 key derivation
  - Persists encrypted blobs to chrome.storage.local under a given key
  - Never persists the passphrase; callers should keep it in memory only
*/

export interface EncryptedPayload {
  s: string; // base64 salt
  i: string; // base64 iv
  c: string; // base64 ciphertext (includes auth tag for SubtleCrypto AES-GCM)
}

function enc(): TextEncoder {
  return new TextEncoder();
}
function dec(): TextDecoder {
  return new TextDecoder();
}

function toBase64(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  // 250k iterations for decent security while keeping perf acceptable in content scripts
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 250_000
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptObject(obj: unknown, passphrase: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = enc().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { s: toBase64(salt.buffer), i: toBase64(iv.buffer), c: toBase64(cipher) };
}

export async function decryptObject<T = unknown>(payload: EncryptedPayload, passphrase: string): Promise<T> {
  const salt = fromBase64(payload.s);
  const iv = fromBase64(payload.i);
  const key = await deriveKey(passphrase, salt);
  const cipher = fromBase64(payload.c);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  const text = dec().decode(plain);
  return JSON.parse(text) as T;
}

// chrome.storage helpers
async function storageGetRaw<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const result = await chrome.storage.local.get([key]);
    return result?.[key] as T | undefined;
  } catch {
    return undefined;
  }
}

async function storageSetRaw(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // ignore
  }
}

export async function saveEncrypted(key: string, obj: unknown, passphrase: string): Promise<void> {
  const payload = await encryptObject(obj, passphrase);
  await storageSetRaw(key, payload);
}

export async function loadEncrypted<T = unknown>(key: string, passphrase: string): Promise<T | null> {
  const payload = (await storageGetRaw<EncryptedPayload>(key)) || null;
  if (!payload) return null;
  try {
    return await decryptObject<T>(payload, passphrase);
  } catch {
    return null; // wrong passphrase or corrupted data
  }
}
