import { findTemplate, loadSettings, saveSettings, type ExtensionSettings, type TemplateDefinition } from '../lib/settings';

const MENU_ROOT = 'aiaf::root';
const MENU_QUICK_FILL = 'aiaf::quick-fill';
const MENU_QUICK_EXTRACT = 'aiaf::quick-extract';

function createMenuItem(options: chrome.contextMenus.CreateProperties): void {
  chrome.contextMenus.create(options, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      // eslint-disable-next-line no-console
      console.warn('[AIAutoFill] context menu creation failed', err.message);
    }
  });
}

async function ensureContextMenus(): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.contextMenus.removeAll(() => {
      resolve();
    });
  }).catch(() => undefined);

  const contexts: chrome.contextMenus.ContextType[] = ['page', 'frame', 'editable', 'selection'];

  createMenuItem({ id: MENU_ROOT, title: 'AIAutoFill', contexts });
  createMenuItem({
    id: MENU_QUICK_FILL,
    parentId: MENU_ROOT,
    title: 'Quick Fill from Template',
    contexts
  });
  createMenuItem({
    id: MENU_QUICK_EXTRACT,
    parentId: MENU_ROOT,
    title: 'Extract Fields to Template',
    contexts
  });
}

function openOptionsPage(): void {
  if (typeof chrome.runtime.openOptionsPage === 'function') {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
  }
}

function sendMessageToTab<T>(tabId: number, message: unknown): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T | undefined);
    });
  });
}

async function handleQuickFill(tabId: number): Promise<void> {
  try {
    const settings = await loadSettings();
    const template = findTemplate(settings, settings.quickFillTemplateId || settings.quickExtractTemplateId);
    if (!template) {
      openOptionsPage();
      return;
    }
    await sendMessageToTab(tabId, {
      type: 'AIAF_APPLY_TEMPLATE',
      values: template.values
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[AIAutoFill] quick fill failed', error);
  }
}

async function handleQuickExtract(tabId: number): Promise<void> {
  try {
    const settings = await loadSettings();
    const templateId = settings.quickExtractTemplateId || settings.quickFillTemplateId;
    const template = findTemplate(settings, templateId);
    if (!template) {
      openOptionsPage();
      return;
    }

    const response = await sendMessageToTab<{ data?: Record<string, unknown> }>(tabId, {
      type: 'AIAF_EXTRACT_TEMPLATE'
    });
    const extracted = response?.data;
    if (!extracted) return;

    const normalized: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(extracted)) {
      if (!rawKey) continue;
      const key = rawKey.trim();
      if (!key) continue;
      if (rawValue == null) continue;
      const str = typeof rawValue === 'string' ? rawValue : String(rawValue);
      if (str.trim().length === 0) continue;
      normalized[key] = str;
    }

    if (Object.keys(normalized).length === 0) return;

    await saveSettings((prev) => {
      const idx = prev.templates.findIndex((t) => t.id === template.id);
      if (idx < 0) return prev;
      const existing = prev.templates[idx];
      const mergedValues = { ...existing.values, ...normalized };
      const updated: TemplateDefinition = {
        ...existing,
        values: mergedValues,
        updatedAt: Date.now()
      };
      const templates = [...prev.templates];
      templates[idx] = updated;
      return { ...prev, templates } as ExtensionSettings;
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[AIAutoFill] quick extract failed', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // eslint-disable-next-line no-console
  console.log('AIAutoFill extension installed');
  void ensureContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenus();
});

void ensureContextMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_QUICK_FILL) {
    void handleQuickFill(tab.id);
  } else if (info.menuItemId === MENU_QUICK_EXTRACT) {
    void handleQuickExtract(tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ type: 'PONG' });
  }
});
