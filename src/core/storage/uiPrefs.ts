const UI_PREFS_STORAGE_KEY = 'aiaf.uiPrefs.v1';

export interface UiPrefs {
  collapseSiteOverrides: boolean;
  collapseSession: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  collapseSiteOverrides: true,
  collapseSession: true
};

function storageLocalGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve(undefined);
        return;
      }
      resolve((result?.[key] as T | undefined) ?? undefined);
    });
  });
}

function storageLocalSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

export async function readUiPrefs(): Promise<UiPrefs> {
  const stored = await storageLocalGet<Partial<UiPrefs>>(UI_PREFS_STORAGE_KEY);
  if (!stored) {
    return { ...DEFAULT_UI_PREFS };
  }
  return {
    collapseSiteOverrides: stored.collapseSiteOverrides ?? DEFAULT_UI_PREFS.collapseSiteOverrides,
    collapseSession: stored.collapseSession ?? DEFAULT_UI_PREFS.collapseSession
  } satisfies UiPrefs;
}

export async function writeUiPrefs(next: UiPrefs): Promise<UiPrefs> {
  const value: UiPrefs = {
    collapseSiteOverrides: Boolean(next.collapseSiteOverrides),
    collapseSession: Boolean(next.collapseSession)
  };
  await storageLocalSet(UI_PREFS_STORAGE_KEY, value);
  return value;
}

export async function updateUiPrefs(
  update: Partial<UiPrefs> | ((current: UiPrefs) => Partial<UiPrefs> | UiPrefs)
): Promise<UiPrefs> {
  const current = await readUiPrefs();
  const nextRaw = typeof update === 'function' ? update(current) : update;
  const merged = {
    ...current,
    ...(nextRaw as Partial<UiPrefs>)
  } satisfies UiPrefs;
  return writeUiPrefs(merged);
}

export { UI_PREFS_STORAGE_KEY };
