/*
  Filler utilities for AIAutoFill
  - Set values using native property descriptors (value/checked/selected)
  - Dispatch input/change/blur and keyboard events
  - Adapters for React/Vue/Angular controlled components
  - Handles text inputs, textarea, contenteditable, select, radio, checkbox
  - Attempts to support masked inputs by simulating typing
*/

export type Framework = 'auto' | 'react' | 'vue' | 'angular' | 'none';

export interface FillOptions {
  framework?: Framework;
  simulateTyping?: boolean; // prefer typing for mask-aware inputs
  typingDelayMs?: number; // for async typing (not used; events dispatched synchronously)
  blurAfter?: boolean;
}

export interface FillResult {
  changed: boolean;
  message?: string;
}

function isHTMLElement(el: Element): el is HTMLElement {
  return el instanceof HTMLElement;
}

function isInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement;
}

function isTextArea(el: Element): el is HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement;
}

function isSelect(el: Element): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement;
}

function isContentEditable(el: Element): el is HTMLElement {
  return isHTMLElement(el) && !!el.isContentEditable;
}

function getProto(el: Element): object {
  if (isInput(el)) return window.HTMLInputElement.prototype;
  if (isTextArea(el)) return window.HTMLTextAreaElement.prototype;
  if (isSelect(el)) return window.HTMLSelectElement.prototype;
  return Object.getPrototypeOf(el) as object;
}

function getPropertySetter<T extends Element, K extends PropertyKey>(
  el: T,
  prop: K
): ((this: unknown, v: unknown) => void) | null {
  let proto: object | null = getProto(el);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc && typeof desc.set === 'function') return desc.set as (this: unknown, v: unknown) => void;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return null;
}

function dispatch(el: Element, ev: Event): void {
  try {
    el.dispatchEvent(ev);
  } catch {
    // ignore
  }
}

function createInputEvent(
  type: 'input' | 'change' | 'beforeinput',
  opts: (EventInit & Partial<InputEventInit>) = {} as EventInit & Partial<InputEventInit>
): Event {
  const init: EventInit & Partial<InputEventInit> = { bubbles: true, cancelable: type !== 'change', ...opts };
  try {
    // Try specialized constructors first
    if (type === 'input' || type === 'beforeinput') {
      // Some browsers don't support InputEvent init dict fully, fallback to Event
      // @ts-expect-error - InputEvent may not accept the full init dict type in older libdefs
      return new InputEvent(type, init as InputEventInit);
    }
    return new Event(type, init);
  } catch {
    return new Event(type, { bubbles: true });
  }
}

function createKeyboardEvent(type: 'keydown' | 'keypress' | 'keyup', key: string): KeyboardEvent {
  const init: KeyboardEventInit = {
    bubbles: true,
    cancelable: true,
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    charCode: key.length === 1 ? key.charCodeAt(0) : 0,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
  };
  try {
    return new KeyboardEvent(type, init);
  } catch {
    // Safari old fallback
    const ev = document.createEvent('KeyboardEvent');
    // @ts-expect-error - legacy initKeyboardEvent is not typed in modern libdefs
    ev.initKeyboardEvent(type, true, true, window, key, 0, '', false, '');
    return ev as KeyboardEvent;
  }
}

function focusIfNeeded(el: HTMLElement) {
  try {
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

function blurIfRequested(el: HTMLElement, options?: FillOptions) {
  if (!options?.blurAfter) return;
  try {
    if (document.activeElement === el) el.blur();
  } catch {
    // ignore
  }
}

// Framework detection heuristics
export function detectFramework(el: Element): Exclude<Framework, 'auto'> {
  // React: internal properties on DOM nodes
  const anyEl = el as unknown as Record<string, unknown>;
  const keys = Object.keys(anyEl);
  if (keys.some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'))) return 'react';
  // Vue 2: __vue__ on element; Vue 3: __vueParentComponent on closest component root
  const vueMarkers = anyEl as { __vue__?: unknown; __vueParentComponent?: unknown };
  if (vueMarkers.__vue__ || vueMarkers.__vueParentComponent) return 'vue';
  // Angular: attribute ng-version on root element or parent chain
  let node: Element | null = el;
  while (node) {
    if ((node as HTMLElement).hasAttribute && (node as HTMLElement).hasAttribute('ng-version')) return 'angular';
    node = node.parentElement;
  }
  return 'none';
}

function effectiveFramework(el: Element, options?: FillOptions): Exclude<Framework, 'auto'> {
  if (options?.framework && options.framework !== 'auto') return options.framework;
  return detectFramework(el);
}

// Set value using native descriptor and fire the right events
export function setTextLikeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, options: FillOptions = {}): FillResult {
  if (el.readOnly || el.disabled) return { changed: false, message: 'readonly or disabled' };

  const framework = effectiveFramework(el, options);
  const setter = getPropertySetter(el, 'value');
  const before = el.value;

  focusIfNeeded(el);

  // Choose strategy: simulate typing for masks, otherwise direct set
  const shouldType = !!options.simulateTyping;

  if (!setter) {
    el.value = value;
  } else if (shouldType) {
    // Clear first via native setter + event
    setter.call(el, '');
    dispatch(el, createInputEvent('input', { inputType: 'deleteContentBackward', data: null }));

    // Type character by character
    for (const ch of value) {
      dispatch(el, createKeyboardEvent('keydown', ch));
      dispatch(el, createKeyboardEvent('keypress', ch));
      setter.call(el, el.value + ch);
      dispatch(el, createInputEvent('input', { inputType: 'insertText', data: ch }));
      dispatch(el, createKeyboardEvent('keyup', ch));
    }
  } else {
    // Direct set via native setter
    setter.call(el, value);
    // Fire input event which React/Vue/Angular listen to
    dispatch(el, createInputEvent('input'));
  }

  // For selectText inputs (not selects) frameworks also expect change on blur or programmatically
  if (framework === 'angular' || framework === 'none' || options.blurAfter) {
    dispatch(el, createInputEvent('change'));
  }

  blurIfRequested(el, options);

  return { changed: before !== el.value };
}

export function setContentEditableValue(el: HTMLElement, value: string, options: FillOptions = {}): FillResult {
  if (!el.isContentEditable) return { changed: false, message: 'not contenteditable' };
  const before = el.innerText;
  focusIfNeeded(el);

  // Try beforeinput + input
  const sel = window.getSelection?.();
  if (sel) {
    try {
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.addRange(r);
    } catch {
      // ignore
    }
  }

  el.innerHTML = '';
  el.textContent = '';
  // Use execCommand as last resort for some editors
  try {
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
  } catch {
    // ignore
  }

  dispatch(el, createInputEvent('beforeinput', { inputType: 'insertText', data: value }));
  el.textContent = value;
  dispatch(el, createInputEvent('input', { inputType: 'insertText', data: value }));
  dispatch(el, createInputEvent('change'));

  blurIfRequested(el, options);

  return { changed: before !== value };
}

export function setCheckbox(el: HTMLInputElement, checked: boolean, options: FillOptions = {}): FillResult {
  if (el.type !== 'checkbox') return { changed: false, message: 'not a checkbox' };
  if (el.disabled) return { changed: false, message: 'disabled' };

  const setter = getPropertySetter(el, 'checked');
  const before = el.checked;

  focusIfNeeded(el);

  if (!setter) {
    el.checked = checked;
  } else {
    setter.call(el, checked);
  }

  // Notify frameworks. Prefer untrusted click then change which React listens to
  dispatch(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
  dispatch(el, createInputEvent('change'));

  blurIfRequested(el, options);

  return { changed: before !== el.checked };
}

export function setRadio(el: HTMLInputElement, options: FillOptions = {}): FillResult {
  if (el.type !== 'radio') return { changed: false, message: 'not a radio' };
  if (el.disabled) return { changed: false, message: 'disabled' };

  const before = el.checked;
  const setter = getPropertySetter(el, 'checked');

  focusIfNeeded(el);

  if (!before) {
    // Uncheck siblings in same group
    if (el.name) {
      const form = el.form || el.ownerDocument;
      const radios = form?.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      if (radios) {
        for (const r of Array.from(radios)) {
          if (r !== el) {
            const s = getPropertySetter(r, 'checked');
            if (s) s.call(r, false);
            else r.checked = false;
          }
        }
      }
    }
    if (setter) setter.call(el, true);
    else el.checked = true;
  }

  dispatch(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
  dispatch(el, createInputEvent('change'));

  blurIfRequested(el, options);

  return { changed: before !== el.checked };
}

export function setSelectValue(el: HTMLSelectElement, value: string | string[], options: FillOptions = {}): FillResult {
  if (el.disabled) return { changed: false, message: 'disabled' };

  const isMultiple = el.multiple;
  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  const setter = getPropertySetter(el, 'value');
  const before = Array.from(el.selectedOptions).map((o) => o.value);
  let changed = false;

  if (isMultiple) {
    const setSelected = (opt: HTMLOptionElement, sel: boolean) => {
      const s = getPropertySetter(opt, 'selected');
      if (s) s.call(opt, sel);
      else opt.selected = sel;
    };
    const optionsList = Array.from(el.options);
    const wanted = new Set(values);
    for (const opt of optionsList) {
      const shouldSel = wanted.has(opt.value);
      if (opt.selected !== shouldSel) {
        setSelected(opt, shouldSel);
        changed = true;
      }
    }
  } else {
    const val = values[0] ?? '';
    if (setter) setter.call(el, val);
    else el.value = val;
    changed = before[0] !== el.value;
  }

  // React listens on change for select
  dispatch(el, createInputEvent('input'));
  dispatch(el, createInputEvent('change'));

  blurIfRequested(el, options);

  return { changed };
}

export function fillElement(el: Element, value: unknown, options: FillOptions = {}): FillResult {
  if (!isHTMLElement(el)) return { changed: false, message: 'not an HTMLElement' };

  // Material UI / Ant Design wrappers often use underlying input element
  const inputLike = ((): HTMLElement | null => {
    if (isInput(el) || isTextArea(el) || isSelect(el)) return el;
    // MUI InputBase>input
    const input = el.querySelector('input, textarea, select');
    if (input && input instanceof HTMLElement) return input;
    return el;
  })();

  if (isInput(inputLike)) {
    const type = inputLike.type.toLowerCase();
    if (type === 'checkbox') return setCheckbox(inputLike, Boolean(value), options);
    if (type === 'radio') return setRadio(inputLike, options);
    // common masked input detection heuristics
    const looksMasked =
      !!options.simulateTyping ||
      /mask|inputmask|cleave|numberformat/i.test(
        [inputLike.placeholder, inputLike.name, inputLike.className].filter(Boolean).join(' ')
      );
    return setTextLikeValue(inputLike, String(value ?? ''), { ...options, simulateTyping: looksMasked });
  }

  if (isTextArea(inputLike)) {
    return setTextLikeValue(inputLike, String(value ?? ''), options);
  }

  if (isSelect(inputLike)) {
    return setSelectValue(inputLike, (value as string | string[] | undefined) ?? '', options);
  }

  if (isContentEditable(inputLike)) {
    return setContentEditableValue(inputLike, String(value ?? ''), options);
  }

  // ARIA role based textboxes
  const role = inputLike.getAttribute('role');
  if (role && /^(textbox|searchbox|combobox)$/i.test(role)) {
    return setContentEditableValue(inputLike, String(value ?? ''), options);
  }

  return { changed: false, message: 'unsupported element' };
}

// Convenience helpers to fill by label text where possible
export function findCandidateByLabelText(root: ParentNode, text: string): HTMLElement | null {
  text = text.trim().toLowerCase();
  // label[for]
  const labels = root.querySelectorAll('label');
  for (const label of Array.from(labels)) {
    const t = (label.textContent || '').trim().toLowerCase();
    if (t && t.includes(text)) {
      const forId = label.getAttribute('for');
      if (forId) {
        const target = (root as Document).getElementById?.(forId) || root.querySelector(`#${CSS.escape(forId)}`);
        if (target && target instanceof HTMLElement) return target;
      }
      // wrapping
      const input = label.querySelector('input,textarea,select,[contenteditable=""],[contenteditable="true"]');
      if (input && input instanceof HTMLElement) return input;
    }
  }
  // aria-label direct
  const direct = root.querySelector<HTMLElement>(
    `input[aria-label*="${CSS.escape(text)}" i],textarea[aria-label*="${CSS.escape(text)}" i],select[aria-label*="${CSS.escape(
      text
    )}" i]`
  );
  if (direct) return direct;
  return null;
}

// Expose for debugging in the page
try {
  (window as unknown as Record<string, unknown>).__AIAutoFill__ = {
    fillElement,
    setTextLikeValue,
    setSelectValue,
    setCheckbox,
    setRadio,
    detectFramework
  };
} catch {
  // ignore
}
