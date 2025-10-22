// Encrypted local storage service using passphrase-derived keys (AES-GCM)
// API exports:
// - deriveKey(passphrase: string, saltBase64: string): Promise<CryptoKey>
// - encrypt(value: string | object, passphrase: string): Promise<{ cipher: string; iv: string; salt: string }>
// - decrypt(bundle: { cipher: string; iv: string; salt: string }, passphrase: string): Promise<string>
// - setItem(key: string, value: string | object, passphrase: string): Promise<void>
// - getItem(key: string, passphrase: string): Promise<string | null>
// - removeItem(key: string): void
// - clear(): void
// - listKeys(): string[]

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const decryptedCache = new Map();

function getRandomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64) {
  const binString = atob(b64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i += 1) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKey(passphrase, saltBase64) {
  const salt = fromBase64(saltBase64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(value, passphrase) {
  const iv = getRandomBytes(12); // AES-GCM recommended IV length
  const salt = getRandomBytes(16);
  const key = await deriveKey(passphrase, toBase64(salt));
  const data = typeof value === 'string' ? value : JSON.stringify(value);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(data)
  );
  return {
    cipher: toBase64(new Uint8Array(cipherBuffer)),
    iv: toBase64(iv),
    salt: toBase64(salt)
  };
}

export async function decrypt(bundle, passphrase) {
  const { cipher, iv, salt } = bundle || {};
  if (!cipher || !iv || !salt) return '';
  const key = await deriveKey(passphrase, salt);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(cipher)
  );
  return textDecoder.decode(plainBuffer);
}

const KEY_PREFIX = 'enc:';

function collectPrefixedKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const candidate = localStorage.key(i);
    if (candidate && candidate.startsWith(KEY_PREFIX)) {
      keys.push(candidate);
    }
  }
  return keys;
}

export async function setItem(key, value, passphrase) {
  const bundle = await encrypt(value, passphrase);
  localStorage.setItem(KEY_PREFIX + key, JSON.stringify(bundle));
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  decryptedCache.set(key, serialized);
}

export async function getItem(key, passphrase) {
  if (decryptedCache.has(key)) {
    return decryptedCache.get(key);
  }
  const raw = localStorage.getItem(KEY_PREFIX + key);
  if (!raw) return null;
  const bundle = JSON.parse(raw);
  const plain = await decrypt(bundle, passphrase);
  decryptedCache.set(key, plain);
  return plain;
}

export function removeItem(key) {
  localStorage.removeItem(KEY_PREFIX + key);
  decryptedCache.delete(key);
}

export function clear() {
  const keys = listKeys();
  for (const k of keys) {
    localStorage.removeItem(k);
  }
  decryptedCache.clear();
}

export function listKeys() {
  return collectPrefixedKeys();
}

if (
  typeof globalThis !== 'undefined' &&
  typeof globalThis.addEventListener === 'function' &&
  typeof localStorage !== 'undefined'
) {
  globalThis.addEventListener('storage', (storageEvent) => {
    if (storageEvent.storageArea !== localStorage) return;
    const { key } = storageEvent;
    if (!key || !key.startsWith(KEY_PREFIX)) return;
    decryptedCache.delete(key.slice(KEY_PREFIX.length));
  });
}
