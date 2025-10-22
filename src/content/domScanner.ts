/*
  DOM Scanner for AIAutoFill
  - Traverses regular DOM, open Shadow DOM, and same-origin iframes
  - Extracts candidate form controls: input/select/textarea/contenteditable/custom ARIA textboxes
  - Computes accessible names from aria-labelledby, aria-label, labels, placeholders, titles, and nearby text
  - Records attributes and geometry context
  - Sets up MutationObservers with throttled rescans
*/

export interface AccessibleName {
  value: string | null;
  sources: string[]; // e.g., ['aria-labelledby', 'label[for]', 'placeholder']
}

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Candidate {
  id: string; // stable-ish identifier based on path
  path: string; // css path inside its root (Document or ShadowRoot)
  framePath: string[]; // css selectors for iframe elements from top-level down to this root
  rootType: 'document' | 'shadow-root' | 'iframe';

  tagName: string;
  type?: string | null;
  role?: string | null;
  isContentEditable: boolean;
  isCustomControl: boolean; // non-native form control (role based or contenteditable without native tag)

  attributes: Record<string, string | null | undefined>;
  classes: string[];

  disabled: boolean;
  hidden: boolean;

  viewportRect: Rect; // rect relative to top-level window viewport
  accessibleName: AccessibleName;
  description?: string | null; // from aria-describedby if present
}

export interface ScanResult {
  candidates: Candidate[];
  scannedAt: number;
  durationMs: number;
}

export interface DomScannerOptions {
  throttleMs?: number; // default 500ms
  onCandidates?: (result: ScanResult) => void;
}

export interface DomScannerController {
  stop: () => void;
  rescanNow: () => void;
}

const DEFAULT_THROTTLE_MS = 600;

const CANDIDATE_SELECTOR = [
  // native controls
  'input:not([type="hidden"])',
  'select',
  'textarea',
  // contenteditable
  '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  // common ARIA roles used for custom text inputs
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]'
].join(',');

function isHTMLElement(el: Element): el is HTMLElement {
  return el instanceof HTMLElement;
}

function isFormControl(el: Element): boolean {
  if (!isHTMLElement(el)) return false;
  if (el.closest('template')) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return (el as HTMLInputElement).type !== 'hidden';
  if (tag === 'select' || tag === 'textarea') return true;
  if (el.hasAttribute('contenteditable')) return true;
  const role = el.getAttribute('role');
  if (role && /^(textbox|searchbox|combobox)$/i.test(role)) return true;
  return false;
}

function isDisabled(el: Element): boolean {
  if (!isHTMLElement(el)) return false;
  const tag = el.tagName.toLowerCase();
  if ((tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') && (el as HTMLInputElement).disabled) {
    return true;
  }
  // aria-disabled on any element
  const ariaDisabled = el.getAttribute('aria-disabled');
  return ariaDisabled === 'true';
}

function isHiddenByAttr(el: Element): boolean {
  if (!isHTMLElement(el)) return false;
  if (el.hasAttribute('hidden')) return true;
  const ariaHidden = el.getAttribute('aria-hidden');
  if (ariaHidden === 'true') return true;
  return false;
}

function hasBox(el: Element): boolean {
  if (!isHTMLElement(el) || !el.isConnected) return false;
  try {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  }
}

function getViewportRect(el: Element, frameChain: Element[]): Rect {
  const rect = el.getBoundingClientRect();
  let top = rect.top;
  let left = rect.left;
  const width = rect.width;
  const height = rect.height;
  let right = rect.right;
  let bottom = rect.bottom;

  // accumulate offsets for each iframe ancestor (outermost first)
  for (const frameEl of frameChain) {
    const fRect = frameEl.getBoundingClientRect();
    top += fRect.top;
    left += fRect.left;
    right += fRect.left;
    bottom += fRect.top;
  }
  return { top, left, right, bottom, width, height };
}

function cssEscapeSafe(s: string): string {
  // CSS.escape may not be defined in all environments
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  if (typeof g.CSS?.escape === 'function') {
    return g.CSS.escape!(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

// (helper removed)
function getCssPath(el: Element): string {
  const segments: string[] = [];
  let node: Element | null = el;

  while (node) {
    const tag = node.tagName.toLowerCase();
    let segment = tag;
    if (node.id) {
      segment = `${tag}#${cssEscapeSafe(node.id)}`;
      segments.unshift(segment);
      break; // ids are unique enough within this root
    }
    const classList = Array.from(node.classList);
    if (classList.length) {
      segment += '.' + classList.slice(0, 3).map(cssEscapeSafe).join('.');
    }
    // nth-of-type for uniqueness among siblings of same tag
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => (c as Element).tagName.toLowerCase() === tag);
      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1; // 1-based
        segment += `:nth-of-type(${index})`;
      }
    }
    segments.unshift(segment);
    node = node.parentElement;
    if (!node) break;
  }

  return segments.join('>');
}

function findByIdInRoot(root: Document | ShadowRoot, id: string): Element | null {
  if ((root as Document).getElementById) {
    const el = (root as Document).getElementById(id);
    if (el) return el;
  }
  try {
    return root.querySelector(`#${cssEscapeSafe(id)}`);
  } catch {
    return null;
  }
}

function getInnerTextSafe(el: Element): string {
  try {
    // innerText approximates visible text better than textContent
    // fallback to textContent if innerText not available
    if (isHTMLElement(el)) return el.innerText;
    return el.textContent || '';
  } catch {
    return el.textContent || '';
  }
}

function getAssociatedLabelText(el: Element): string | null {
  // 1) aria-labelledby
  const root = el.getRootNode() as Document | ShadowRoot;
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const ids = ariaLabelledby.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (const id of ids) {
      const labelledEl = findByIdInRoot(root, id);
      if (labelledEl) {
        const t = getInnerTextSafe(labelledEl).trim();
        if (t) parts.push(t);
      }
    }
    if (parts.length) return parts.join(' ');
  }

  // 2) aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  // 3) <label for="id">
  const id = (el as HTMLElement).id;
  if (id) {
    try {
      const explicitLabel = root.querySelector(`label[for="${cssEscapeSafe(id)}"]`);
      if (explicitLabel) {
        const t = getInnerTextSafe(explicitLabel).trim();
        if (t) return t;
      }
    } catch {
      // ignore
    }
  }

  // 4) wrapping <label>
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) {
    const t = getInnerTextSafe(wrappingLabel).trim();
    if (t) return t;
  }

  // 5) fieldset legend context
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const t = getInnerTextSafe(legend).trim();
      if (t) return t;
    }
  }

  // 6) placeholder
  const placeholder = (el as HTMLElement).getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return placeholder.trim();

  // 7) title attribute
  const title = (el as HTMLElement).getAttribute('title');
  if (title && title.trim()) return title.trim();

  // 8) name attribute
  const name = (el as HTMLElement).getAttribute('name');
  if (name && name.trim()) return name.trim();

  // 9) nearby text heuristic
  const nearby = findNearbyText(el);
  if (nearby && nearby.trim()) return nearby.trim();

  return null;
}

function findNearbyText(el: Element): string | null {
  // Heuristic: look for the closest previous sibling with meaningful text,
  // then walk up to parent if none found. Prefer elements positioned to the left or above.
  const MAX_DISTANCE_PX = 300;
  const elRect = (el as HTMLElement).getBoundingClientRect();

  function scoreCandidate(cand: Element): number {
    const text = getInnerTextSafe(cand).trim();
    if (!text) return -Infinity;
    const r = cand.getBoundingClientRect();
    // strong preference for left or above
    const dx = r.right <= elRect.left ? elRect.left - r.right : (r.left - elRect.right);
    const dy = r.bottom <= elRect.top ? elRect.top - r.bottom : (r.top - elRect.bottom);
    const distance = Math.sqrt(Math.max(0, dx)) + Math.sqrt(Math.max(0, dy));
    if (distance > MAX_DISTANCE_PX) return -Infinity;
    // incorporate text length lightly
    return -distance + Math.min(30, text.length * 0.5);
  }

  let container: Element | null = el.parentElement;
  while (container) {
    const children = Array.from(container.children);
    const index = children.indexOf(el as Element);
    const previous = children.slice(0, index).reverse();
    let best: { el: Element; score: number } | null = null;
    for (const p of previous) {
      const s = scoreCandidate(p);
      if (s > (best?.score ?? -Infinity)) best = { el: p, score: s };
      if (best && best.score > 0) break; // good enough
    }
    if (best && best.score > -Infinity) {
      const t = getInnerTextSafe(best.el).trim();
      if (t) return t;
    }
    el = container; // move up
    container = container.parentElement;
  }
  return null;
}

function computeAccessibleName(el: Element): AccessibleName {
  const sources: string[] = [];

  // Follow priority order
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const val = getAssociatedLabelText(el);
    if (val) {
      sources.push('aria-labelledby');
      return { value: val, sources };
    }
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    sources.push('aria-label');
    return { value: ariaLabel.trim(), sources };
  }

  const labelForOrWrap = getAssociatedLabelText(el);
  if (labelForOrWrap) {
    sources.push('label');
    return { value: labelForOrWrap, sources };
  }

  const placeholder = (el as HTMLElement).getAttribute('placeholder');
  if (placeholder && placeholder.trim()) {
    sources.push('placeholder');
    return { value: placeholder.trim(), sources };
  }

  const title = (el as HTMLElement).getAttribute('title');
  if (title && title.trim()) {
    sources.push('title');
    return { value: title.trim(), sources };
  }

  const nearby = findNearbyText(el);
  if (nearby && nearby.trim()) {
    sources.push('nearby');
    return { value: nearby.trim(), sources };
  }

  return { value: null, sources };
}

// (unused helper removed)

function getDescriptionFromAriaDescribedby(el: Element): string | null {
  const ids = (el.getAttribute('aria-describedby') || '').trim();
  if (!ids) return null;
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  for (const id of ids.split(/\s+/)) {
    const d = findByIdInRoot(root, id);
    if (d) {
      const t = getInnerTextSafe(d).trim();
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join(' ') : null;
}

function buildCandidate(el: Element, root: Document | ShadowRoot, frameChain: Element[]): Candidate | null {
  if (!isFormControl(el)) return null;

  const disabled = isDisabled(el);
  const hiddenAttr = isHiddenByAttr(el);
  const hasRect = hasBox(el);

  // skip non-rendered elements entirely
  if (!hasRect) return null;

  const viewportRect = getViewportRect(el, frameChain);
  const accessibleName = computeAccessibleName(el);
  const role = el.getAttribute('role');
  const isContentEditable = el.hasAttribute('contenteditable');
  const tagName = el.tagName.toLowerCase();
  const type = tagName === 'input' ? (el as HTMLInputElement).type || 'text' : null;
  const isNative = tagName === 'input' || tagName === 'select' || tagName === 'textarea';
  const isCustomControl = !isNative && (isContentEditable || (role ? /^(textbox|searchbox|combobox)$/i.test(role) : false));

  const attributes: Record<string, string | null | undefined> = {
    id: (el as HTMLElement).id || null,
    name: (el as HTMLElement).getAttribute('name'),
    type,
    placeholder: (el as HTMLElement).getAttribute('placeholder'),
    autocomplete: (el as HTMLElement).getAttribute('autocomplete'),
    role,
    'aria-label': el.getAttribute('aria-label'),
    'aria-labelledby': el.getAttribute('aria-labelledby'),
    'aria-describedby': el.getAttribute('aria-describedby'),
    title: (el as HTMLElement).getAttribute('title')
  };

  const classes = Array.from(el.classList);

  const path = getCssPath(el);
  const framePath = frameChain.map((f) => getCssPath(f));

  const id = `${framePath.join('>')}||${path}`;

  return {
    id,
    path,
    framePath,
    rootType: frameChain.length ? 'iframe' : (root instanceof ShadowRoot ? 'shadow-root' : 'document'),
    tagName,
    type,
    role,
    isContentEditable,
    isCustomControl,
    attributes,
    classes,
    disabled,
    hidden: hiddenAttr,
    viewportRect,
    accessibleName,
    description: getDescriptionFromAriaDescribedby(el)
  };
}

function listShadowHosts(root: Document | ShadowRoot): Element[] {
  // Scan all elements and pick those with open shadow roots
  const out: Element[] = [];
  try {
    const all = root.querySelectorAll('*');
    for (const el of Array.from(all)) {
      const host = el as HTMLElement & { shadowRoot?: ShadowRoot | null };
      if (host.shadowRoot) out.push(host);
    }
  } catch {
    // ignore
  }
  return out;
}

function listSameOriginFrames(root: Document | ShadowRoot): HTMLIFrameElement[] {
  // Find only <iframe> elements; <frame> is deprecated and omitted for simplicity
  const frames: HTMLIFrameElement[] = [];
  let iframeNodes: NodeListOf<Element>;
  try {
    iframeNodes = root.querySelectorAll('iframe');
  } catch {
    return frames;
  }
  for (const node of Array.from(iframeNodes)) {
    if (!(node instanceof HTMLIFrameElement)) continue;
    try {
      const doc = node.contentDocument;
      // Same-origin if contentDocument accessible
      if (doc) frames.push(node);
    } catch {
      // cross-origin - ignore
    }
  }
  return frames;
}

function scanRoot(root: Document | ShadowRoot, frameChain: Element[], candidates: Candidate[]) {
  // 1) candidates within this root
  let nodes: NodeListOf<Element> | null = null;
  try {
    nodes = root.querySelectorAll(CANDIDATE_SELECTOR);
  } catch {
    nodes = null;
  }

  if (nodes) {
    for (const el of Array.from(nodes)) {
      const cand = buildCandidate(el, root, frameChain);
      if (cand) candidates.push(cand);
    }
  }

  // 2) recurse into shadow roots
  const shadowHosts = listShadowHosts(root);
  for (const host of shadowHosts) {
    const hostEl = host as HTMLElement & { shadowRoot?: ShadowRoot | null };
    const sr = hostEl.shadowRoot ?? null;
    if (sr) scanRoot(sr, frameChain, candidates);
  }

  // 3) recurse into same-origin iframes
  const frames = listSameOriginFrames(root);
  for (const iframe of frames) {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        scanRoot(doc, [...frameChain, iframe], candidates);
      }
    } catch {
      // ignore cross-origin frames
    }
  }
}

function nowTs(): number {
  return Date.now();
}

function nowHighRes(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function uniqueById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function createThrottler(fn: () => void, wait: number) {
  let timer: number | null = null;
  let pending = false;
  const schedule = () => {
    if (timer != null) {
      pending = true;
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      fn();
      if (pending) {
        pending = false;
        schedule();
      }
    }, wait);
  };
  const flush = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    pending = false;
    fn();
  };
  return { schedule, flush };
}

export function startDomScanner(options: DomScannerOptions = {}): DomScannerController {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const observers: MutationObserver[] = [];
  const observedRoots = new WeakSet<Document | ShadowRoot>();

  const runScan = () => {
    const start = nowHighRes();
    const candidates: Candidate[] = [];
    scanRoot(document, [], candidates);
    const durationMs = Math.max(0, Number((nowHighRes() - start).toFixed(3)));
    const result: ScanResult = {
      candidates: uniqueById(candidates),
      scannedAt: nowTs(),
      durationMs
    };
    if (options.onCandidates) options.onCandidates(result);
  };

  const throttler = createThrottler(runScan, throttleMs);

  function observeRoot(root: Document | ShadowRoot) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);

    const obs = new MutationObserver(() => {
      throttler.schedule();
    });
    try {
      obs.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: [
          'id',
          'name',
          'type',
          'class',
          'placeholder',
          'autocomplete',
          'aria-label',
          'aria-labelledby',
          'aria-describedby',
          'aria-hidden',
          'aria-disabled',
          'disabled',
          'role',
          'style',
          'contenteditable',
          'title',
          'value',
          'hidden'
        ]
      });
      observers.push(obs);
    } catch {
      // ignore observe errors
    }

    // Also proactively observe nested roots from here
    // shadow
    for (const host of listShadowHosts(root)) {
      const hostEl = host as HTMLElement & { shadowRoot?: ShadowRoot | null };
      const sr = hostEl.shadowRoot ?? null;
      if (sr) observeRoot(sr);
    }
    // frames
    for (const frame of listSameOriginFrames(root)) {
      try {
        const doc = frame.contentDocument;
        if (doc) observeRoot(doc);
      } catch {
        // ignore
      }
    }
  }

  // initial observers
  observeRoot(document);

  // handle dynamically added shadow roots and iframes by periodically checking
  const periodicCheck = window.setInterval(() => {
    try {
      // top-level
      observeRoot(document);
      // nested
      for (const host of listShadowHosts(document)) {
        const hostEl = host as HTMLElement & { shadowRoot?: ShadowRoot | null };
        const sr = hostEl.shadowRoot ?? null;
        if (sr) observeRoot(sr);
      }
      for (const frame of listSameOriginFrames(document)) {
        const doc = frame.contentDocument;
        if (doc) observeRoot(doc);
      }
    } catch {
      // ignore
    }
  }, Math.max(2000, throttleMs * 2));

  // initial scan
  throttler.flush();

  return {
    stop: () => {
      for (const obs of observers) {
        try {
          obs.disconnect();
        } catch {
          // ignore
        }
      }
      observers.length = 0;
      window.clearInterval(periodicCheck);
    },
    rescanNow: () => throttler.flush()
  };
}
