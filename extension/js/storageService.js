import { storageLocal, nowIso, bytesToBase64, randomBytes } from './utils.js';
import { deriveAesGcmKey, encryptString, decryptString } from './cryptoService.js';
import { EncryptedPayloadSchema, SettingsSchema, IndexSchema } from './schemas.js';

const DB_NAME = 'AIAutoFillDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';
const SETTINGS_KEY = 'aiAutoFill_settings_v1';
const INDEX_KEY = 'aiAutoFill_index_v1';

let currentKey = null; // CryptoKey kept in-memory only
let currentSettings = null;

// IndexedDB helpers
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

async function idbPut(record) {
  return withStore('readwrite', (store) => store.put(record));
}

async function idbGet(key) {
  return withStore('readonly', (store) => store.get(key));
}

async function idbDelete(key) {
  return withStore('readwrite', (store) => store.delete(key));
}

async function idbGetAllKeys() {
  return withStore('readonly', (store) => store.getAllKeys());
}

// Chrome storage index helpers
async function getIndex() {
  const { [INDEX_KEY]: stored } = await storageLocal.get({ [INDEX_KEY]: { keys: [] } });
  const parsed = IndexSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  return { keys: [] };
}

async function setIndex(index) {
  const parsed = IndexSchema.safeParse(index);
  if (!parsed.success) throw new Error('Invalid index');
  await storageLocal.set({ [INDEX_KEY]: parsed.data });
}

async function addKeyToIndex(key) {
  const index = await getIndex();
  if (!index.keys.includes(key)) index.keys.push(key);
  await setIndex(index);
}

async function removeKeyFromIndex(key) {
  const index = await getIndex();
  const next = index.keys.filter((k) => k !== key);
  await setIndex({ keys: next });
}

// Settings helpers
export async function getSettings() {
  const { [SETTINGS_KEY]: s } = await storageLocal.get(SETTINGS_KEY);
  const parsed = s ? SettingsSchema.safeParse(s) : { success: false };
  if (parsed.success) return parsed.data;
  return null;
}

async function setSettings(obj) {
  const parsed = SettingsSchema.safeParse(obj);
  if (!parsed.success) throw new Error('Invalid settings');
  await storageLocal.set({ [SETTINGS_KEY]: parsed.data });
  currentSettings = parsed.data;
}

export function hasKeyInMemory() {
  return !!currentKey;
}

export async function setPassphrase(passphrase, { iterations = 250000, saltBytes = 16 } = {}) {
  const salt = bytesToBase64(randomBytes(saltBytes));
  const key = await deriveAesGcmKey(passphrase, salt, iterations, 'SHA-256');
  const verification = await encryptString(key, 'ok');
  const settings = {
    v: 1,
    passphraseSet: true,
    kdf: { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    verification
  };
  await setSettings(settings);
  currentKey = key;
  return true;
}

export async function unlockWithPassphrase(passphrase) {
  const settings = await getSettings();
  if (!settings?.passphraseSet) throw new Error('No passphrase set');
  const { salt, iterations, hash } = settings.kdf;
  const key = await deriveAesGcmKey(passphrase, salt, iterations, hash);
  // verify
  try {
    const text = await decryptString(key, settings.verification.iv, settings.verification.ciphertext);
    if (text !== 'ok') throw new Error('Verification failed');
  } catch {
    throw new Error('Incorrect passphrase');
  }
  currentKey = key;
  currentSettings = settings;
  return true;
}

export function lock() {
  currentKey = null;
}

export async function changePassphrase(currentPassphrase, newPassphrase, { iterations = 250000, saltBytes = 16 } = {}) {
  // Verify current
  await unlockWithPassphrase(currentPassphrase);
  const oldKey = currentKey;

  // Derive new key and settings
  const newSalt = bytesToBase64(randomBytes(saltBytes));
  const newKey = await deriveAesGcmKey(newPassphrase, newSalt, iterations, 'SHA-256');
  const verification = await encryptString(newKey, 'ok');
  const newSettings = {
    v: 1,
    passphraseSet: true,
    kdf: { name: 'PBKDF2', salt: newSalt, iterations, hash: 'SHA-256' },
    verification
  };

  // Re-encrypt all records
  const keys = await getIndex().then((i) => i.keys);
  for (const key of keys) {
    const rec = await idbGet(key);
    if (!rec) continue;
    try {
      const plaintext = await decryptString(oldKey, rec.payload.iv, rec.payload.ciphertext);
      const enc = await encryptString(newKey, plaintext);
      const payload = {
        v: 1,
        alg: 'AES-GCM',
        kdf: newSettings.kdf,
        iv: enc.iv,
        ciphertext: enc.ciphertext,
        createdAt: rec.payload.createdAt || nowIso()
      };
      await idbPut({ key, payload });
    } catch (e) {
      console.error('Failed to re-encrypt record', key, e);
    }
  }

  await setSettings(newSettings);
  currentKey = newKey;
  currentSettings = newSettings;
  return true;
}

// CRUD
export async function saveItem(key, plaintext) {
  if (!currentKey) throw new Error('Locked: set or unlock passphrase');
  const settings = currentSettings || await getSettings();
  if (!settings) throw new Error('Settings not found');
  const enc = await encryptString(currentKey, plaintext);
  const payload = {
    v: 1,
    alg: 'AES-GCM',
    kdf: settings.kdf,
    iv: enc.iv,
    ciphertext: enc.ciphertext,
    createdAt: nowIso()
  };
  const parsed = EncryptedPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Invalid encrypted payload');
  await idbPut({ key, payload: parsed.data });
  await addKeyToIndex(key);
  return true;
}

export async function loadItem(key) {
  if (!currentKey) throw new Error('Locked: set or unlock passphrase');
  const rec = await idbGet(key);
  if (!rec) return null;
  const payload = rec.payload;
  const parsed = EncryptedPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Corrupted payload');
  const text = await decryptString(currentKey, payload.iv, payload.ciphertext);
  return text;
}

export async function removeItem(key) {
  await idbDelete(key);
  await removeKeyFromIndex(key);
}

export async function listKeys() {
  const index = await getIndex();
  return index.keys;
}

export async function clearAll() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
  await storageLocal.remove([INDEX_KEY]);
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
