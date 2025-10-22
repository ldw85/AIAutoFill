export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export function bytesFromString(str) {
  return textEncoder.encode(str);
}

export function stringFromBytes(bytes) {
  return textDecoder.decode(bytes);
}

export function randomBytes(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

export function bytesToBase64(bytes) {
  // Convert to string first
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function nowIso() {
  return new Date().toISOString();
}

// Chrome storage wrapper with fallback to localStorage when not in extension context
export const storageLocal = {
  async get(keyOrKeys) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.get(keyOrKeys, resolve));
    }
    // Fallback
    if (typeof keyOrKeys === 'string') {
      const v = localStorage.getItem(keyOrKeys);
      return { [keyOrKeys]: v ? JSON.parse(v) : undefined };
    }
    if (Array.isArray(keyOrKeys)) {
      const out = {};
      for (const k of keyOrKeys) {
        const v = localStorage.getItem(k);
        out[k] = v ? JSON.parse(v) : undefined;
      }
      return out;
    }
    if (typeof keyOrKeys === 'object') {
      const out = { ...keyOrKeys };
      for (const k of Object.keys(keyOrKeys)) {
        const v = localStorage.getItem(k);
        out[k] = v ? JSON.parse(v) : keyOrKeys[k];
      }
      return out;
    }
    return {};
  },
  async set(obj) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
    }
    // Fallback
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  },
  async remove(keys) {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
    }
    // Fallback
    if (!Array.isArray(keys)) keys = [keys];
    for (const k of keys) {
      localStorage.removeItem(k);
    }
  }
};
