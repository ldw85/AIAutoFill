import type {
  RuntimeMessage,
  RuntimeResponse,
  SettingsUpdatePayload,
  TemplateSavePayload,
  PassphraseChangePayload,
  UnlockResult,
  TemplateListResult,
  TemplateMutationResult,
  TemplateDeleteResult,
  SettingsSnapshot
} from '../core/messages';
import type {
  ConflictStrategy,
  InformationFieldKey,
  Mode,
  RuntimeSettings,
  TemplateModel,
  TemplateValues
} from '../core/model/schemas';
import {
  DEFAULT_RUNTIME_SETTINGS,
  effectiveMode,
  mergeRuntimeSettings,
  normaliseRuntimeSettings,
  normaliseTemplateInput
} from '../core/model/schemas';
import {
  PBKDF2_ITERATIONS,
  KEY_LENGTH,
  type CipherPayload,
  createVerification,
  decodeBytes,
  deriveKey,
  encryptJson,
  decryptJson,
  encodeBytes,
  generateSalt,
  verifyKey
} from '../core/storage/crypto';
import {
  deleteTemplate as removeTemplateRecord,
  readAllTemplates,
  readTemplate,
  writeTemplate,
  writeTemplatesBatch,
  type TemplateRecord
} from '../core/storage/db';
import {
  MASTER_STORAGE_KEY,
  SECRETS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY
} from '../core/storage/keys';

interface MasterRecord {
  salt: string;
  verification: CipherPayload;
  iterations: number;
  createdAt: number;
  updatedAt: number;
}

interface SecretsRecord {
  semanticApiKey?: CipherPayload;
}

interface TemplatePayloadV1 {
  values: TemplateValues;
  version?: number;
}

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function filterNonEmptyValues(values: TemplateValues): TemplateValues {
  const result: TemplateValues = {};
  for (const key of Object.keys(values) as InformationFieldKey[]) {
    const value = values[key];
    if (hasNonEmptyValue(value)) {
      result[key] = value as string;
    }
  }
  return result;
}

function mergeTemplateValues(base: TemplateValues, incoming: TemplateValues, strategy: ConflictStrategy): TemplateValues {
  if (strategy === 'replace') {
    return filterNonEmptyValues(incoming);
  }
  const result: TemplateValues = filterNonEmptyValues(base);
  if (strategy === 'keep') {
    for (const key of Object.keys(incoming) as InformationFieldKey[]) {
      const value = incoming[key];
      if (!hasNonEmptyValue(value)) continue;
      if (!hasNonEmptyValue(result[key])) {
        result[key] = value as string;
      }
    }
    return result;
  }
  for (const key of Object.keys(incoming) as InformationFieldKey[]) {
    const value = incoming[key];
    if (!hasNonEmptyValue(value)) continue;
    const incomingValue = value as string;
    const existing = result[key];
    if (!hasNonEmptyValue(existing)) {
      result[key] = incomingValue;
      continue;
    }
    const existingValue = existing as string;
    if (existingValue.toLowerCase() === incomingValue.toLowerCase()) {
      continue;
    }
    const parts = existingValue
      .split('•')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const lower = new Set(parts.map((part) => part.toLowerCase()));
    if (!lower.has(incomingValue.toLowerCase())) {
      parts.push(incomingValue);
    }
    result[key] = parts.join(' • ');
  }
  return result;
}

function hasPopulatedValues(values: TemplateValues): boolean {
  for (const key of Object.keys(values) as InformationFieldKey[]) {
    if (hasNonEmptyValue(values[key])) {
      return true;
    }
  }
  return false;
}

class WorkerError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'WorkerError';
    this.code = code;
  }
}

let unlockedKey: CryptoKey | null = null;
const textEncoder = new TextEncoder();

function handleRuntimeError(reject: (reason?: unknown) => void): boolean {
  const err = chrome.runtime.lastError;
  if (err) {
    reject(new Error(err.message));
    return true;
  }
  return false;
}

function storageLocalGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (handleRuntimeError(reject)) return;
      resolve((result?.[key] as T | undefined) ?? undefined);
    });
  });
}

function storageLocalSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (handleRuntimeError(reject)) return;
      resolve();
    });
  });
}

function storageLocalRemove(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (handleRuntimeError(reject)) return;
      resolve();
    });
  });
}


async function getMasterRecord(): Promise<MasterRecord | null> {
  const record = await storageLocalGet<MasterRecord>(MASTER_STORAGE_KEY);
  if (!record || !record.salt || !record.verification) {
    return null;
  }
  const iterations = Number(record.iterations) || PBKDF2_ITERATIONS;
  return {
    salt: record.salt,
    verification: record.verification,
    iterations,
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now()
  };
}

async function setMasterRecord(record: MasterRecord): Promise<void> {
  await storageLocalSet(MASTER_STORAGE_KEY, record);
}

async function getSecretsRecord(): Promise<SecretsRecord | null> {
  const record = await storageLocalGet<SecretsRecord>(SECRETS_STORAGE_KEY);
  if (!record) return null;
  return record;
}

async function setSecretsRecord(record: SecretsRecord | null): Promise<void> {
  if (!record || Object.keys(record).length === 0) {
    await storageLocalRemove(SECRETS_STORAGE_KEY);
    return;
  }
  await storageLocalSet(SECRETS_STORAGE_KEY, record);
}

function setUnlockedKey(key: CryptoKey): void {
  unlockedKey = key;
}

function clearUnlockedState(): void {
  unlockedKey = null;
}

async function deriveKeyWithIterations(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (iterations === PBKDF2_ITERATIONS) {
    return deriveKey(passphrase, salt);
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
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

async function getStoredSettings(): Promise<RuntimeSettings> {
  const raw = await storageLocalGet<unknown>(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
  return normaliseRuntimeSettings(raw);
}

async function saveStoredSettings(
  update: Partial<{ mode: Mode; overrides: SettingsUpdatePayload['overrides']; semanticEndpoint: string }>
): Promise<RuntimeSettings> {
  const current = await getStoredSettings();
  const next = mergeRuntimeSettings(current, {
    mode: update.mode,
    overrides: update.overrides,
    semanticEndpoint: update.semanticEndpoint
  });
  await storageLocalSet(SETTINGS_STORAGE_KEY, next);
  return next;
}

function ensurePassphraseStrength(passphrase: string): void {
  if (!passphrase || passphrase.trim().length < 8) {
    throw new WorkerError('PASSPHRASE_TOO_SHORT', 'Passphrase must be at least 8 characters long.');
  }
}

function generateTemplateId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tmpl-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function isApiKeyConfigured(): Promise<boolean> {
  const secrets = await getSecretsRecord();
  return Boolean(secrets?.semanticApiKey);
}

async function saveSemanticApiKey(value: string | null, key: CryptoKey): Promise<void> {
  const secrets = (await getSecretsRecord()) ?? {};
  if (value && value.trim()) {
    secrets.semanticApiKey = await encryptJson(value.trim(), key);
  } else {
    delete secrets.semanticApiKey;
  }
  await setSecretsRecord(secrets);
}

async function readSemanticApiKey(key: CryptoKey): Promise<string | null> {
  const secrets = await getSecretsRecord();
  if (!secrets?.semanticApiKey) return null;
  const decrypted = await decryptJson<string>(secrets.semanticApiKey, key);
  return decrypted ?? null;
}

async function listTemplatesForKey(key: CryptoKey): Promise<TemplateModel[]> {
  const records = await readAllTemplates();
  const templates: TemplateModel[] = [];
  for (const record of records) {
    try {
      const payload = await decryptJson<TemplatePayloadV1>(record.payload, key);
      templates.push({
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        values: payload?.values ?? {}
      });
    } catch {
      throw new WorkerError('DECRYPT_FAILED', 'Unable to decrypt template.');
    }
  }
  return templates;
}

async function saveTemplateWithKey(payload: TemplateSavePayload, key: CryptoKey): Promise<{ template: TemplateModel; templates: TemplateModel[] }> {
  const normalised = normaliseTemplateInput(payload);
  const id = normalised.id?.trim() || generateTemplateId();
  const existingRecord = await readTemplate(id);
  let existingValues: TemplateValues = {};
  if (existingRecord) {
    try {
      const decoded = await decryptJson<TemplatePayloadV1>(existingRecord.payload, key);
      existingValues = decoded?.values ?? {};
    } catch {
      throw new WorkerError('DECRYPT_FAILED', 'Unable to decrypt template.');
    }
  }
  const mergedValues = mergeTemplateValues(existingValues, normalised.values, normalised.conflictStrategy);
  if (!hasPopulatedValues(mergedValues)) {
    throw new WorkerError('EMPTY_TEMPLATE', 'Add at least one populated field');
  }
  const now = Date.now();
  const encrypted = await encryptJson<TemplatePayloadV1>({ values: mergedValues }, key);
  const record: TemplateRecord = {
    id,
    label: normalised.label,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    payload: encrypted
  };
  await writeTemplate(record);
  const templates = await listTemplatesForKey(key);
  const template = templates.find((item) => item.id === id) ?? {
    id,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    values: mergedValues
  };
  return { template, templates };
}

async function deleteTemplateWithKey(id: string, key: CryptoKey): Promise<TemplateModel[]> {
  await removeTemplateRecord(id);
  return listTemplatesForKey(key);
}

async function unlockWithPassphrase(passphrase: string): Promise<UnlockResult> {
  const trimmed = passphrase.trim();
  if (!trimmed) {
    throw new WorkerError('INVALID_PASSPHRASE', 'Passphrase is required.');
  }
  const existing = await getMasterRecord();
  if (!existing) {
    ensurePassphraseStrength(trimmed);
    const salt = generateSalt();
    const key = await deriveKey(trimmed, salt);
    const verification = await createVerification(key);
    const record: MasterRecord = {
      salt: encodeBytes(salt),
      verification,
      iterations: PBKDF2_ITERATIONS,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await setMasterRecord(record);
    setUnlockedKey(key);
    return { status: 'created' } satisfies UnlockResult;
  }

  const salt = decodeBytes(existing.salt);
  const iterations = existing.iterations ?? PBKDF2_ITERATIONS;
  const key = await deriveKeyWithIterations(trimmed, salt, iterations);
  const valid = await verifyKey(key, existing.verification);
  if (!valid) {
    throw new WorkerError('INVALID_PASSPHRASE', 'Incorrect passphrase.');
  }
  setUnlockedKey(key);
  return { status: 'unlocked' } satisfies UnlockResult;
}

async function changePassphrase(payload: PassphraseChangePayload): Promise<void> {
  const current = payload.current.trim();
  const next = payload.next.trim();
  if (!current) throw new WorkerError('INVALID_PASSPHRASE', 'Current passphrase is required.');
  ensurePassphraseStrength(next);
  const master = await getMasterRecord();
  if (!master) {
    throw new WorkerError('PASSPHRASE_NOT_SET', 'Set a passphrase before attempting to change it.');
  }
  const salt = decodeBytes(master.salt);
  const iterations = master.iterations ?? PBKDF2_ITERATIONS;
  const oldKey = await deriveKeyWithIterations(current, salt, iterations);
  const valid = await verifyKey(oldKey, master.verification);
  if (!valid) {
    throw new WorkerError('INVALID_PASSPHRASE', 'Incorrect current passphrase.');
  }

  const templates = await readAllTemplates();
  const decryptedTemplates: Array<{ record: TemplateRecord; values: TemplateValues }> = [];
  for (const record of templates) {
    const payload = await decryptJson<TemplatePayloadV1>(record.payload, oldKey);
    decryptedTemplates.push({ record, values: payload?.values ?? {} });
  }
  const existingApiKey = await readSemanticApiKey(oldKey);

  const newSalt = generateSalt();
  const newKey = await deriveKey(next, newSalt);
  const newVerification = await createVerification(newKey);

  const reencryptedRecords: TemplateRecord[] = [];
  for (const item of decryptedTemplates) {
    const encrypted = await encryptJson<TemplatePayloadV1>({ values: item.values }, newKey);
    reencryptedRecords.push({
      ...item.record,
      payload: encrypted
    });
  }

  if (reencryptedRecords.length > 0) {
    await writeTemplatesBatch(reencryptedRecords);
  }

  await saveSemanticApiKey(existingApiKey, newKey);

  const updatedRecord: MasterRecord = {
    salt: encodeBytes(newSalt),
    verification: newVerification,
    iterations: PBKDF2_ITERATIONS,
    createdAt: master.createdAt,
    updatedAt: Date.now()
  };
  await setMasterRecord(updatedRecord);
  setUnlockedKey(newKey);
}

async function requireUnlockedKey(): Promise<CryptoKey> {
  if (!unlockedKey) {
    throw new WorkerError('LOCKED', 'Unlock the session to continue.');
  }
  return unlockedKey;
}

async function handleSettingsGet(origin?: string): Promise<RuntimeResponse<SettingsSnapshot>> {
  const settings = await getStoredSettings();
  const master = await getMasterRecord();
  const snapshot = {
    mode: settings.mode,
    overrides: settings.overrides,
    semanticEndpoint: settings.semanticEndpoint,
    hasPassphrase: Boolean(master),
    unlocked: Boolean(unlockedKey),
    apiKeyConfigured: await isApiKeyConfigured(),
    effectiveMode: origin ? effectiveMode(settings, origin.toLowerCase()) : undefined
  } satisfies SettingsSnapshot;
  return { success: true, data: snapshot } satisfies RuntimeResponse<SettingsSnapshot>;
}

async function handleSettingsSet(payload: SettingsUpdatePayload): Promise<RuntimeResponse<{ settings: RuntimeSettings }>> {
  const update: Partial<{ mode: Mode; overrides: SettingsUpdatePayload['overrides']; semanticEndpoint: string }> = {};
  if (payload.mode) update.mode = payload.mode;
  if (payload.overrides) update.overrides = payload.overrides;
  if (payload.semantic && Object.prototype.hasOwnProperty.call(payload.semantic, 'endpoint')) {
    update.semanticEndpoint = (payload.semantic?.endpoint ?? '').trim();
  }
  const nextSettings = await saveStoredSettings(update);

  if (payload.semantic && Object.prototype.hasOwnProperty.call(payload.semantic, 'apiKey')) {
    const key = await requireUnlockedKey();
    await saveSemanticApiKey(payload.semantic?.apiKey ?? null, key);
  }

  return {
    success: true,
    data: { settings: nextSettings }
  } satisfies RuntimeResponse<{ settings: RuntimeSettings }>;
}

async function handleTemplateList(): Promise<RuntimeResponse<TemplateListResult>> {
  const key = await requireUnlockedKey();
  const templates = await listTemplatesForKey(key);
  return { success: true, data: { templates } } satisfies RuntimeResponse<TemplateListResult>;
}

async function handleTemplateSave(payload: TemplateSavePayload): Promise<RuntimeResponse<TemplateMutationResult>> {
  const key = await requireUnlockedKey();
  const { template, templates } = await saveTemplateWithKey(payload, key);
  notifyTemplatesUpdated();
  return { success: true, data: { template, templates } } satisfies RuntimeResponse<TemplateMutationResult>;
}

async function handleTemplateDelete(id: string): Promise<RuntimeResponse<TemplateDeleteResult>> {
  const key = await requireUnlockedKey();
  const templates = await deleteTemplateWithKey(id, key);
  notifyTemplatesUpdated();
  return { success: true, data: { templates } } satisfies RuntimeResponse<TemplateDeleteResult>;
}

async function handleUnlock(passphrase: string): Promise<RuntimeResponse<UnlockResult>> {
  const result = await unlockWithPassphrase(passphrase);
  notifyTemplatesUpdated();
  return { success: true, data: result } satisfies RuntimeResponse<UnlockResult>;
}

async function handleLock(): Promise<RuntimeResponse<null>> {
  clearUnlockedState();
  notifyTemplatesUpdated();
  return { success: true, data: null } satisfies RuntimeResponse<null>;
}

async function handlePassphraseChange(payload: PassphraseChangePayload): Promise<RuntimeResponse<null>> {
  await changePassphrase(payload);
  notifyTemplatesUpdated();
  return { success: true, data: null } satisfies RuntimeResponse<null>;
}

function notifyTemplatesUpdated(): void {
  try {
    chrome.runtime.sendMessage({ type: 'AIAF_TEMPLATES_UPDATED' }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore delivery errors
  }
}

function respond<T>(sendResponse: (response?: RuntimeResponse<T>) => void, response: RuntimeResponse<T>): void {
  sendResponse(response);
}

function respondError(sendResponse: (response?: RuntimeResponse<never>) => void, error: unknown): void {
  if (error instanceof WorkerError) {
    sendResponse({ success: false, error: error.message, code: error.code });
    return;
  }
  if (error instanceof Error) {
    sendResponse({ success: false, error: error.message });
    return;
  }
  sendResponse({ success: false, error: 'Unknown error' });
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    try {
      const existing = await storageLocalGet<unknown>(SETTINGS_STORAGE_KEY);
      if (!existing) {
        await storageLocalSet(SETTINGS_STORAGE_KEY, { ...DEFAULT_RUNTIME_SETTINGS });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[AIAutoFill] failed to initialise settings on install', error);
    }
  })();
});

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const messageType = (rawMessage as { type?: string } | undefined)?.type;
  if (messageType === 'PING') {
    sendResponse({ type: 'PONG' });
    return;
  }

  const message = rawMessage as RuntimeMessage | undefined;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  void (async () => {
    try {
      switch (message.type) {
        case 'SETTINGS_GET': {
          const response = await handleSettingsGet(message.origin);
          respond(sendResponse, response);
          return;
        }
        case 'SETTINGS_SET': {
          const response = await handleSettingsSet(message.payload);
          respond(sendResponse, response);
          return;
        }
        case 'UNLOCK': {
          const response = await handleUnlock(message.passphrase);
          respond(sendResponse, response);
          return;
        }
        case 'LOCK': {
          const response = await handleLock();
          respond(sendResponse, response);
          return;
        }
        case 'TEMPLATE_LIST': {
          const response = await handleTemplateList();
          respond(sendResponse, response);
          return;
        }
        case 'TEMPLATE_SAVE': {
          const response = await handleTemplateSave(message.payload);
          respond(sendResponse, response);
          return;
        }
        case 'TEMPLATE_DELETE': {
          const response = await handleTemplateDelete(message.id);
          respond(sendResponse, response);
          return;
        }
        case 'PASSPHRASE_CHANGE': {
          const response = await handlePassphraseChange(message.payload);
          respond(sendResponse, response);
          return;
        }
        default:
          sendResponse({ success: false, error: `Unhandled message type: ${message.type}` });
      }
    } catch (error) {
      respondError(sendResponse, error);
    }
  })();

  return true;
});
