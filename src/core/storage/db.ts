import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CipherPayload } from './crypto';

const DB_NAME = 'aiaf.db';
const DB_VERSION = 1;
const STORE_TEMPLATES = 'templates';

export interface TemplateRecord {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  payload: CipherPayload;
}

interface AiafDbSchema extends DBSchema {
  [STORE_TEMPLATES]: {
    key: string;
    value: TemplateRecord;
    indexes: {
      'by-updatedAt': number;
      'by-label': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AiafDbSchema>> | null = null;

async function getDb(): Promise<IDBPDatabase<AiafDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AiafDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
          const store = db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
          store.createIndex('by-updatedAt', 'updatedAt');
          store.createIndex('by-label', 'label');
        }
      }
    });
  }
  return dbPromise;
}

export async function readAllTemplates(): Promise<TemplateRecord[]> {
  const db = await getDb();
  const records = await db.getAll(STORE_TEMPLATES);
  return records.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export async function readTemplate(id: string): Promise<TemplateRecord | undefined> {
  const db = await getDb();
  return db.get(STORE_TEMPLATES, id) ?? undefined;
}

export async function writeTemplate(record: TemplateRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE_TEMPLATES, record);
}

export async function writeTemplatesBatch(records: TemplateRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const db = await getDb();
  const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
  try {
    for (const record of records) {
      await tx.store.put(record);
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // ignore abort errors
    }
    throw error;
  }
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_TEMPLATES, id);
}

export async function clearTemplates(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_TEMPLATES);
}
