import type {
  Mode,
  RuntimeSettings,
  SiteOverride,
  TemplateFieldInput,
  TemplateModel
} from './model/schemas';

export interface SettingsSnapshot {
  mode: Mode;
  overrides: SiteOverride[];
  semanticEndpoint: string;
  hasPassphrase: boolean;
  unlocked: boolean;
  apiKeyConfigured: boolean;
  effectiveMode?: Mode;
}

export interface SettingsUpdatePayload {
  mode?: Mode;
  overrides?: Array<Partial<SiteOverride>>;
  semantic?: {
    endpoint?: string;
    apiKey?: string | null;
  };
}

export interface SettingsSetResult {
  settings: RuntimeSettings;
}

export interface UnlockResult {
  status: 'created' | 'unlocked';
}

export interface TemplateSavePayload {
  id?: string;
  label: string;
  fields: TemplateFieldInput[];
}

export interface TemplateListResult {
  templates: TemplateModel[];
}

export interface TemplateMutationResult {
  template: TemplateModel;
  templates: TemplateModel[];
}

export interface TemplateDeleteResult {
  templates: TemplateModel[];
}

export interface PassphraseChangePayload {
  current: string;
  next: string;
}

export type RuntimeMessage =
  | { type: 'SETTINGS_GET'; origin?: string }
  | { type: 'SETTINGS_SET'; payload: SettingsUpdatePayload }
  | { type: 'UNLOCK'; passphrase: string }
  | { type: 'LOCK' }
  | { type: 'TEMPLATE_LIST' }
  | { type: 'TEMPLATE_SAVE'; payload: TemplateSavePayload }
  | { type: 'TEMPLATE_DELETE'; id: string }
  | { type: 'PASSPHRASE_CHANGE'; payload: PassphraseChangePayload };

export interface RuntimeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export function sendRuntimeMessage<T = unknown>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T>) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response ?? { success: false, error: 'No response from background worker' });
    });
  });
}
