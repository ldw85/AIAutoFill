import { getSettings, setPassphrase, unlockWithPassphrase, changePassphrase, hasKeyInMemory, saveItem, listKeys, clearAll } from './js/storageService.js';

const el = (id) => document.getElementById(id);

function setStatus(text, detail = '', ok = null) {
  el('status-text').textContent = text;
  el('status-detail').textContent = detail;
  el('status-text').className = ok === null ? 'muted' : ok ? 'ok' : 'error';
}

async function refresh() {
  const s = await getSettings();
  const inMemory = hasKeyInMemory();
  if (!s || !s.passphraseSet) {
    setStatus('No passphrase set', 'Set a passphrase to enable encryption');
    el('setup').classList.remove('hidden');
    el('change').classList.add('hidden');
    el('devtools').classList.add('hidden');
  } else {
    setStatus(inMemory ? 'Unlocked' : 'Locked', inMemory ? 'Key is held in memory until you lock or close the page' : 'Enter your passphrase to unlock');
    el('setup').classList.add('hidden');
    el('change').classList.remove('hidden');
    el('devtools').classList.remove('hidden');
  }
}

async function onSetPassphrase() {
  const p1 = el('new-passphrase').value.trim();
  const p2 = el('new-passphrase-confirm').value.trim();
  const iters = parseInt(el('iterations').value, 10) || 250000;
  const saltBytes = parseInt(el('salt-bytes').value, 10) || 16;
  const msg = el('setup-msg');
  if (!p1 || p1 !== p2) {
    msg.textContent = 'Passphrases do not match';
    return;
  }
  try {
    await setPassphrase(p1, { iterations: iters, saltBytes });
    msg.textContent = 'Passphrase set. The key is unlocked for this page.';
    await refresh();
  } catch (e) {
    msg.textContent = 'Failed to set passphrase: ' + (e?.message || e);
  }
}

async function onChangePassphrase() {
  const cur = el('current-passphrase').value.trim();
  const p1 = el('change-new-passphrase').value.trim();
  const p2 = el('change-new-passphrase-confirm').value.trim();
  const msg = el('change-msg');
  if (!p1 || p1 !== p2) {
    msg.textContent = 'New passphrases do not match';
    return;
  }
  try {
    await changePassphrase(cur, p1);
    msg.textContent = 'Passphrase changed and data re‑encrypted.';
    await refresh();
  } catch (e) {
    msg.textContent = 'Failed to change passphrase: ' + (e?.message || e);
  }
}

async function onVerifyCurrent() {
  const cur = el('current-passphrase').value.trim();
  const msg = el('change-msg');
  try {
    await unlockWithPassphrase(cur);
    msg.textContent = 'Passphrase verified. Key unlocked for this page.';
    await refresh();
  } catch (e) {
    msg.textContent = 'Incorrect passphrase: ' + (e?.message || e);
  }
}

async function onEncryptSample() {
  try {
    const id = 'sample-' + Date.now();
    await saveItem(id, JSON.stringify({ hello: 'world', at: new Date().toISOString() }));
    el('dev-output').textContent = 'Encrypted and saved item with key ' + id;
  } catch (e) {
    el('dev-output').textContent = 'Error: ' + (e?.message || e);
  }
}

async function onList() {
  const keys = await listKeys();
  el('dev-output').textContent = 'Keys:\n' + keys.join('\n');
}

async function onClear() {
  await clearAll();
  el('dev-output').textContent = 'Cleared all indexed data (not settings).';
}

function bind() {
  el('btn-set').addEventListener('click', onSetPassphrase);
  el('btn-change').addEventListener('click', onChangePassphrase);
  el('btn-verify').addEventListener('click', onVerifyCurrent);
  el('btn-encrypt-sample').addEventListener('click', onEncryptSample);
  el('btn-list').addEventListener('click', onList);
  el('btn-clear').addEventListener('click', onClear);
}

bind();
refresh();
