# AIAutoFill

Auto fill a form with AI.

This repository now includes a minimal Chrome Extension implementation that adds encrypted local storage with a passphrase-derived key. AES-GCM is used for encryption, and the key is derived with PBKDF2 and kept in-memory only. A simple Settings (options) page is provided to set, verify, and change the passphrase. Encrypted records are stored in IndexedDB, and a lightweight index of keys is stored in chrome.storage.local.

Highlights:
- AES-GCM encryption with keys derived from a user passphrase using PBKDF2 (SHA-256)
- Keys are held in-memory only; salts and KDF parameters are stored to allow re-derivation after the user re-enters their passphrase
- IndexedDB used to store encrypted payloads; chrome.storage.local maintains a small index of record keys
- Zod-like schemas (minimal bundled validator) are defined for EncryptedPayload, Settings, and the index structure

Folder structure:
- extension/manifest.json — MV3 extension manifest
- extension/options.html — Settings UI to set/change passphrase
- extension/options.js — Settings UI logic
- extension/js/utils.js — helpers (base64, bytes, storage wrapper)
- extension/js/cryptoService.js — PBKDF2 key derivation and AES-GCM encrypt/decrypt
- extension/js/storageService.js — storage wrapper around IndexedDB and chrome.storage.local index
- extension/js/schemas.js — Zod-like schemas for data validation
- extension/vendor/mini-zod.js — a tiny Zod-like validator used by the schemas

How to load the extension in Chrome:
1. Visit chrome://extensions
2. Enable Developer mode (top right)
3. Click "Load unpacked" and select the `extension` folder in this repo
4. Open the extension's "Details" and click "Extension options" to open the Settings UI

Notes:
- The crypto key is only held in memory in the page where you unlocked it (the Options page). Closing the page or reloading will clear it from memory.
- Changing your passphrase will re-encrypt existing records when possible (requires knowledge of the current passphrase).
