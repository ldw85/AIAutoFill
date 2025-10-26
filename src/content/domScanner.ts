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
  id: string; // stable identity derived from element signature + location
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

  stableElementId: string;
  robustSelector: string;
  formGroupId: string;
  formGroupLabel: string | null;
}

export type FormGroupSource = 'form' | 'fieldset' | 'aria' | 'container' | 'shadow-root' | 'single';

export interface FormGroup {
  id: string;
  label: string;
  hint: string | null;
  source: FormGroupSource;
  fieldCount: number;
  candidateIds: string[];
  framePath: string[];
  rootType: Candidate['rootType'];
  outlineRect: Rect;
}

interface CandidateContext {
  element: Element;
  candidate: Candidate;
  root: Document | ShadowRoot;
  frameChain: Element[];
}

interface GroupAccumulator {
  id: string;
  label: string;
  hint: string | null;
  source: FormGroupSource;
  framePath: string[];
  rootType: Candidate['rootType'];
  candidates: CandidateContext[];
}

export interface ScanResult {
  version: number;
  candidates: Candidate[];
  formGroups: FormGroup[];
  scannedAt: number;
  durationMs: number;
}

export interface DomScannerOptions {
  throttleMs?: number; // default 320ms
  onCandidates?: (result: ScanResult) => void;
}

export interface DomScannerController {
  stop: () => void;
  rescanNow: () => void;
}

const DEFAULT_THROTTLE_MS = 320;

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

const ELEMENT_SIGNATURE_ATTRS = [
  'id',
  'name',
  'type',
  'placeholder',
  'autocomplete',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'role',
  'data-testid',
  'data-test-id',
  'data-qa',
  'data-qa-id'
];

const FORM_GROUP_LABEL_ATTRS = [
  'aria-label',
  'data-form-label',
  'data-form-name',
  'data-form-section',
  'data-group-label',
  'title',
  'name'
];

const SUBMIT_SELECTOR = 'button[type="submit"],input[type="submit"],input[type="image"],button:not([type]):not([disabled]),[data-submit],[data-action="submit"]';
const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"],.form-title,.section-title,.heading,.title';
const GROUP_LIKE_CLASS_SELECTOR = '.form-group,.field-group,.form-section,.form-block,.form-panel,.field-section,.auth-form,.login-form';
const MAX_ANCESTOR_DEPTH = 24;

const STRUCTURAL_GROUP_DEFS: Array<{ selector: string; source: FormGroupSource; fallback: string }> = [
  { selector: 'form', source: 'form', fallback: 'Form' },
  { selector: 'fieldset', source: 'fieldset', fallback: 'Fieldset' },
  { selector: '[role="form"]', source: 'aria', fallback: 'Form' },
  { selector: '[role="group"]', source: 'aria', fallback: 'Input Group' },
  { selector: '[role="radiogroup"]', source: 'aria', fallback: 'Options' },
  { selector: '[data-form-group]', source: 'container', fallback: 'Form Group' },
  { selector: '[data-form-section]', source: 'container', fallback: 'Form Section' },
  { selector: GROUP_LIKE_CLASS_SELECTOR, source: 'container', fallback: 'Form Group' }
];

let submitPresenceCache = new WeakMap<Element, boolean>();
let headingCache = new WeakMap<Element, string | null>();
let actionTextCache = new WeakMap<Element, string | null>();

const elementIdentityMap = new WeakMap<Element, string>();
let elementIdentityCounter = 1;

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

function getStableElementId(el: Element): string {
  const existing = elementIdentityMap.get(el);
  if (existing) return existing;
  const next = `el-${elementIdentityCounter++}`;
  elementIdentityMap.set(el, next);
  return next;
}

function attributeSignature(el: Element): string {
  const pairs: string[] = [];
  for (const attr of ELEMENT_SIGNATURE_ATTRS) {
    const value = el.getAttribute(attr);
    if (value == null) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    pairs.push(`${attr}=${trimmed}`);
  }
  const classList = Array.from(el.classList)
    .map((cls) => cls.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (classList.length) {
    pairs.push(`class=${classList.join('.')}`);
  }
  return pairs.join('|') || 'no-signature';
}

function buildRobustSelector(el: Element, basePath?: string): string {
  const path = basePath ?? getCssPath(el);
  const signature = attributeSignature(el);
  return `${path}|${signature}`;
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

function getLabelFromAriaLabelledby(el: Element): string | null {
  const attr = el.getAttribute('aria-labelledby');
  if (!attr) return null;
  const ids = attr.split(/\s+/).filter(Boolean);
  if (!ids.length) return null;
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  for (const id of ids) {
    const labelled = findByIdInRoot(root, id);
    if (!labelled) continue;
    const text = getInnerTextSafe(labelled).trim();
    if (text) parts.push(text);
  }
  return parts.length ? parts.join(' ') : null;
}

function fallbackGroupLabel(element: Element, fallback: string): string {
  if (!isHTMLElement(element)) return fallback;
  const candidateAttrs = [
    element.getAttribute('name'),
    element.getAttribute('data-form-name'),
    element.getAttribute('data-form-section'),
    element.getAttribute('data-form-label'),
    element.getAttribute('data-testid'),
    element.getAttribute('data-test-id')
  ];
  for (const value of candidateAttrs) {
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed) return `${fallback}: ${trimmed}`;
  }
  if (element.id) return `${fallback} #${element.id}`;
  const classList = Array.from(element.classList);
  if (classList.length) return `${fallback} .${classList[0]}`;
  return fallback;
}

function getFormGroupLabel(el: Element): string | null {
  if (!isHTMLElement(el)) return null;
  if (el.tagName.toLowerCase() === 'fieldset') {
    const legend = el.querySelector('legend');
    if (legend) {
      const legendText = getInnerTextSafe(legend).trim();
      if (legendText) return legendText;
    }
  }
  const labelled = getLabelFromAriaLabelledby(el);
  if (labelled) return labelled;
  for (const attr of FORM_GROUP_LABEL_ATTRS) {
    const value = el.getAttribute(attr);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function frameSignatureFromPath(framePath: string[]): string {
  return framePath.length ? framePath.join('>') : 'top';
}

function getBoundingRectSafe(el: Element): Rect | null {
  if (!isHTMLElement(el) || !el.isConnected) return null;
  try {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

function isSubmitElement(el: Element): boolean {
  if (el instanceof HTMLButtonElement) {
    const type = (el.getAttribute('type') || 'submit').toLowerCase();
    return !type || type === 'submit';
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || '').toLowerCase();
    return type === 'submit' || type === 'image';
  }
  if (isHTMLElement(el)) {
    if (el.getAttribute('data-submit') != null) return true;
    if ((el.getAttribute('data-action') || '').toLowerCase() === 'submit') return true;
  }
  return false;
}

function hasSubmitControl(element: Element): boolean {
  if (submitPresenceCache.has(element)) {
    return submitPresenceCache.get(element) ?? false;
  }
  let found = false;
  if (isSubmitElement(element)) {
    found = true;
  } else {
    try {
      const match = element.querySelector(SUBMIT_SELECTOR);
      if (match) found = true;
    } catch {
      found = false;
    }
  }
  submitPresenceCache.set(element, found);
  return found;
}

function collectAncestry(el: Element, limit = MAX_ANCESTOR_DEPTH): Element[] {
  const ancestry: Element[] = [];
  const seen = new Set<Element>();
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < limit && !seen.has(node)) {
    ancestry.push(node);
    seen.add(node);
    const parent = node.parentElement;
    if (parent) {
      node = parent;
    } else {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        node = root.host ?? null;
      } else {
        break;
      }
    }
    depth++;
  }
  return ancestry;
}

function closestCrossBoundary(el: Element, selector: string): Element | null {
  const ancestry = collectAncestry(el);
  for (const node of ancestry) {
    try {
      if (isHTMLElement(node) && node.matches(selector)) return node;
    } catch {
      // ignore selector errors
    }
  }
  return null;
}

function firstHeadingText(element: Element): string | null {
  if (headingCache.has(element)) {
    return headingCache.get(element) ?? null;
  }
  let text: string | null = null;
  if (isHTMLElement(element)) {
    try {
      if (element.matches(HEADING_SELECTOR)) {
        const value = getInnerTextSafe(element).trim();
        if (value) text = value;
      }
    } catch {
      // ignore
    }
  }
  if (!text) {
    try {
      const heading = element.querySelector(HEADING_SELECTOR);
      if (heading) {
        const value = getInnerTextSafe(heading).trim();
        if (value) text = value;
      }
    } catch {
      // ignore
    }
  }
  headingCache.set(element, text);
  return text;
}

function findNearestAdjacentHeading(element: Element): string | null {
  let node: Element | null = element.previousElementSibling;
  let steps = 0;
  while (node && steps < 4) {
    const text = firstHeadingText(node);
    if (text) return text;
    node = node.previousElementSibling;
    steps++;
  }
  const parent = element.parentElement;
  if (parent) {
    const parentHeading = firstHeadingText(parent);
    if (parentHeading) return parentHeading;
  }
  return null;
}

function findNearestActionText(element: Element): string | null {
  if (actionTextCache.has(element)) {
    return actionTextCache.get(element) ?? null;
  }
  let text: string | null = null;
  const candidates: Element[] = [];
  try {
    const direct = element.querySelector(SUBMIT_SELECTOR);
    if (direct) candidates.push(direct);
  } catch {
    // ignore
  }
  if (!candidates.length) {
    let node: Element | null = element.nextElementSibling;
    let steps = 0;
    while (node && steps < 3) {
      if (isSubmitElement(node)) {
        candidates.push(node);
        break;
      }
      try {
        const match = node.querySelector(SUBMIT_SELECTOR);
        if (match) {
          candidates.push(match);
          break;
        }
      } catch {
        // ignore
      }
      node = node.nextElementSibling;
      steps++;
    }
  }
  for (const candidate of candidates) {
    const value = getInnerTextSafe(candidate).trim() || (candidate as HTMLElement).getAttribute('value')?.trim() || '';
    if (value) {
      text = value;
      break;
    }
  }
  actionTextCache.set(element, text);
  return text;
}

function normaliseGroupLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 160);
}

function deriveGroupText(
  anchor: Element,
  fallback: string,
  candidateName: string | null,
  options?: { preferCandidateName?: boolean }
): { label: string; hint: string | null } {
  const preferCandidate = options?.preferCandidateName ?? false;
  const labelFromAttributes = normaliseGroupLabel(getFormGroupLabel(anchor));
  if (labelFromAttributes) return { label: labelFromAttributes, hint: null };

  const headingInside = normaliseGroupLabel(firstHeadingText(anchor));
  if (headingInside) return { label: headingInside, hint: null };

  const adjacentHeading = normaliseGroupLabel(findNearestAdjacentHeading(anchor));
  if (adjacentHeading) return { label: adjacentHeading, hint: null };

  if (preferCandidate) {
    const candidateLabelPref = normaliseGroupLabel(candidateName);
    if (candidateLabelPref) return { label: candidateLabelPref, hint: null };
  }

  const actionText = normaliseGroupLabel(findNearestActionText(anchor));
  if (actionText) return { label: actionText, hint: null };

  const fallbackLabel = normaliseGroupLabel(fallbackGroupLabel(anchor, fallback));
  if (fallbackLabel) return { label: fallbackLabel, hint: null };

  const candidateLabel = normaliseGroupLabel(candidateName);
  if (candidateLabel) return { label: candidateLabel, hint: null };

  return { label: fallback, hint: null };
}

function buildGroupId(anchor: Element, source: FormGroupSource, framePath: string[]): string {
  const signature = frameSignatureFromPath(framePath);
  const anchorPath = getCssPath(anchor);
  return `${signature}::${source}:${anchorPath}`;
}

function computeGroupOutlineRect(list: CandidateContext[]): Rect {
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const ctx of list) {
    const rect = ctx.candidate.viewportRect;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!list.length || !Number.isFinite(top) || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  return {
    top,
    left,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function dedupeGroupLabels(groups: FormGroup[]): Map<string, string> {
  const seen = new Map<string, number>();
  const labelMap = new Map<string, string>();
  for (const group of groups) {
    const key = group.label.toLowerCase();
    const count = seen.get(key) ?? 0;
    if (count > 0) {
      group.label = `${group.label} (${count + 1})`;
    }
    seen.set(key, count + 1);
    labelMap.set(group.id, group.label);
  }
  return labelMap;
}

interface ResolvedGroup {
  id: string;
  label: string;
  hint: string | null;
  source: FormGroupSource;
}

function resolveGroupForContext(
  ctx: CandidateContext,
  candidateCountMap: WeakMap<Element, number>,
  frameTotals: Map<string, number>
): ResolvedGroup {
  const candidateName = ctx.candidate.accessibleName?.value ?? null;
  for (const def of STRUCTURAL_GROUP_DEFS) {
    const anchor = closestCrossBoundary(ctx.element, def.selector);
    if (!anchor) continue;
    const { label, hint } = deriveGroupText(anchor, def.fallback, candidateName, { preferCandidateName: false });
    const id = buildGroupId(anchor, def.source, ctx.candidate.framePath);
    return { id, label, hint, source: def.source };
  }

  const ancestry = collectAncestry(ctx.element);
  const signature = frameSignatureFromPath(ctx.candidate.framePath);
  const totalInFrame = frameTotals.get(signature) ?? ancestry.length;
  let bestAncestor: Element | null = ctx.element;
  let bestSource: FormGroupSource = 'single';
  let bestScore = Number.POSITIVE_INFINITY;

  for (let depth = 0; depth < ancestry.length; depth++) {
    const ancestor = ancestry[depth];
    const count = candidateCountMap.get(ancestor) ?? 0;
    if (count === 0) continue;

    const isShadowHost = ctx.root instanceof ShadowRoot && ancestor === ctx.root.host;
    const rect = getBoundingRectSafe(ancestor);
    const area = rect ? Math.max(rect.width * rect.height, 1) : 1;
    const normalizedArea = Math.min(area / 400, 600);

    let score = count * 220 + depth * 12 + normalizedArea;
    if (hasSubmitControl(ancestor)) score -= 90;
    if (firstHeadingText(ancestor)) score -= 40;
    if (count === totalInFrame && depth > 0) score += 160;

    let source: FormGroupSource = count > 1 ? 'container' : 'single';
    if (isShadowHost) source = 'shadow-root';

    if (score < bestScore) {
      bestScore = score;
      bestAncestor = ancestor;
      bestSource = source;
    }
  }

  const fallback =
    bestSource === 'single'
      ? candidateName || 'Field'
      : bestSource === 'shadow-root'
        ? 'Shadow Form'
        : 'Form Group';
  const { label, hint } = deriveGroupText(bestAncestor ?? ctx.element, fallback, candidateName, {
    preferCandidateName: bestSource === 'single'
  });
  const id = buildGroupId(bestAncestor ?? ctx.element, bestSource, ctx.candidate.framePath);
  return { id, label, hint, source: bestSource };
}

function finaliseFormGroups(contexts: CandidateContext[]): { candidates: Candidate[]; groups: FormGroup[] } {
  const candidateCountMap = new WeakMap<Element, number>();
  const frameTotals = new Map<string, number>();

  for (const ctx of contexts) {
    const ancestors = collectAncestry(ctx.element);
    const visited = new Set<Element>();
    for (const ancestor of ancestors) {
      if (visited.has(ancestor)) continue;
      visited.add(ancestor);
      candidateCountMap.set(ancestor, (candidateCountMap.get(ancestor) ?? 0) + 1);
    }
    const signature = frameSignatureFromPath(ctx.candidate.framePath);
    frameTotals.set(signature, (frameTotals.get(signature) ?? 0) + 1);
  }

  const groupsById = new Map<string, GroupAccumulator>();

  for (const ctx of contexts) {
    const resolution = resolveGroupForContext(ctx, candidateCountMap, frameTotals);
    let acc = groupsById.get(resolution.id);
    if (!acc) {
      acc = {
        id: resolution.id,
        label: resolution.label,
        hint: resolution.hint,
        source: resolution.source,
        framePath: [...ctx.candidate.framePath],
        rootType: ctx.candidate.rootType,
        candidates: []
      };
      groupsById.set(resolution.id, acc);
    }
    acc.candidates.push(ctx);
    ctx.candidate.formGroupId = resolution.id;
    ctx.candidate.formGroupLabel = resolution.label;
  }

  const groups: FormGroup[] = [];
  for (const acc of groupsById.values()) {
    const outlineRect = computeGroupOutlineRect(acc.candidates);
    const fieldCount = acc.candidates.length;
    groups.push({
      id: acc.id,
      label: acc.label,
      hint: acc.hint,
      source: acc.source,
      fieldCount,
      candidateIds: acc.candidates.map((item) => item.candidate.id),
      framePath: acc.framePath,
      rootType: acc.rootType,
      outlineRect
    });
  }

  groups.sort(
    (a, b) =>
      a.outlineRect.top - b.outlineRect.top ||
      a.outlineRect.left - b.outlineRect.left ||
      b.fieldCount - a.fieldCount
  );

  const labelMap = dedupeGroupLabels(groups);
  for (const ctx of contexts) {
    const label = labelMap.get(ctx.candidate.formGroupId);
    if (label) ctx.candidate.formGroupLabel = label;
  }
  for (const group of groups) {
    group.label = labelMap.get(group.id) ?? group.label;
  }

  const candidates = contexts.map((ctx) => ctx.candidate);
  return { candidates, groups };
}

function buildCandidate(el: Element, root: Document | ShadowRoot, frameChain: Element[]): CandidateContext | null {
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

  const path = getCssPath(el);
  const framePath = frameChain.map((f) => getCssPath(f));
  const frameSignature = frameSignatureFromPath(framePath);
  const stableElementId = getStableElementId(el);
  const signature = attributeSignature(el);
  const robustSelector = buildRobustSelector(el, path);
  const idSegments = [frameSignature, robustSelector, stableElementId];
  const id = idSegments.join('||');

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
    title: (el as HTMLElement).getAttribute('title'),
    'data-testid': el.getAttribute('data-testid'),
    'data-test-id': el.getAttribute('data-test-id'),
    'data-qa': el.getAttribute('data-qa'),
    'data-qa-id': el.getAttribute('data-qa-id'),
    'data-form-group': el.getAttribute('data-form-group'),
    'data-form-section': el.getAttribute('data-form-section'),
    '__signature': signature
  };

  const classes = Array.from(el.classList);
  const rootType: Candidate['rootType'] = frameChain.length
    ? 'iframe'
    : (root instanceof ShadowRoot ? 'shadow-root' : 'document');

  const candidate: Candidate = {
    id,
    path,
    framePath,
    rootType,
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
    description: getDescriptionFromAriaDescribedby(el),
    stableElementId,
    robustSelector,
    formGroupId: '__pending__',
    formGroupLabel: null
  };

  return {
    element: el,
    candidate,
    root,
    frameChain
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

function scanRoot(
  root: Document | ShadowRoot,
  frameChain: Element[],
  contexts: CandidateContext[],
  seenKeys: Set<string>
) {
  // 1) candidates within this root
  let nodes: NodeListOf<Element> | null = null;
  try {
    nodes = root.querySelectorAll(CANDIDATE_SELECTOR);
  } catch {
    nodes = null;
  }

  if (nodes) {
    for (const el of Array.from(nodes)) {
      const context = buildCandidate(el, root, frameChain);
      if (!context) continue;
      const candidateId = context.candidate.id;
      if (seenKeys.has(candidateId)) continue;
      seenKeys.add(candidateId);
      contexts.push(context);
    }
  }

  // 2) recurse into shadow roots
  const shadowHosts = listShadowHosts(root);
  for (const host of shadowHosts) {
    const hostEl = host as HTMLElement & { shadowRoot?: ShadowRoot | null };
    const sr = hostEl.shadowRoot ?? null;
    if (sr) scanRoot(sr, frameChain, contexts, seenKeys);
  }

  // 3) recurse into same-origin iframes
  const frames = listSameOriginFrames(root);
  for (const iframe of frames) {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        scanRoot(doc, [...frameChain, iframe], contexts, seenKeys);
      }
    } catch {
      // ignore cross-origin frames
    }
  }
}

function nodeContainsCandidate(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isFormControl(node)) return true;
  try {
    return Boolean(node.querySelector(CANDIDATE_SELECTOR));
  } catch {
    return false;
  }
}

function invalidateElementTree(node: Node): void {
  if (!(node instanceof Element)) return;
  elementIdentityMap.delete(node);
  try {
    const descendants = node.querySelectorAll('*');
    for (const desc of Array.from(descendants)) {
      elementIdentityMap.delete(desc);
    }
  } catch {
    // ignore traversal failures
  }
}

function mutationsAffectCandidates(records: MutationRecord[]): boolean {
  let shouldTrigger = false;
  for (const record of records) {
    if (record.type === 'childList') {
      for (const removed of Array.from(record.removedNodes)) {
        invalidateElementTree(removed);
        if (!shouldTrigger && nodeContainsCandidate(removed)) {
          shouldTrigger = true;
        }
      }
      if (!shouldTrigger) {
        for (const added of Array.from(record.addedNodes)) {
          if (nodeContainsCandidate(added)) {
            shouldTrigger = true;
            break;
          }
        }
      }
      if (!shouldTrigger) {
        for (const removed of Array.from(record.removedNodes)) {
          if (nodeContainsCandidate(removed)) {
            shouldTrigger = true;
            break;
          }
        }
      }
    } else if (record.type === 'attributes') {
      const target = record.target;
      if (target instanceof Element) {
        if (isFormControl(target) || nodeContainsCandidate(target)) {
          shouldTrigger = true;
        } else if (record.attributeName && FORM_GROUP_LABEL_ATTRS.includes(record.attributeName)) {
          shouldTrigger = true;
        }
      }
    } else if (record.type === 'characterData') {
      const parent = record.target.parentElement;
      if (parent && nodeContainsCandidate(parent)) {
        shouldTrigger = true;
      }
    }
    if (shouldTrigger) {
      // continue loop to allow cleanup on remaining records
      continue;
    }
  }
  return shouldTrigger;
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
  let scanVersion = 0;

  const runScan = () => {
    const start = nowHighRes();
    submitPresenceCache = new WeakMap<Element, boolean>();
    headingCache = new WeakMap<Element, string | null>();
    actionTextCache = new WeakMap<Element, string | null>();

    const contexts: CandidateContext[] = [];
    const seenKeys = new Set<string>();
    scanRoot(document, [], contexts, seenKeys);

    const { candidates, groups } = finaliseFormGroups(contexts);
    candidates.sort(
      (a, b) =>
        a.viewportRect.top - b.viewportRect.top ||
        a.viewportRect.left - b.viewportRect.left ||
        a.stableElementId.localeCompare(b.stableElementId)
    );
    const durationMs = Math.max(0, Number((nowHighRes() - start).toFixed(3)));
    const result: ScanResult = {
      version: ++scanVersion,
      candidates,
      formGroups: groups,
      scannedAt: nowTs(),
      durationMs
    };
    if (options.onCandidates) options.onCandidates(result);
  };

  const throttler = createThrottler(runScan, throttleMs);

  function observeRoot(root: Document | ShadowRoot) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);

    const obs = new MutationObserver((records) => {
      if (mutationsAffectCandidates(records)) {
        throttler.schedule();
      }
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
          'hidden',
          'data-form-label',
          'data-form-name',
          'data-group-label',
          'data-form-group',
          'data-form-section',
          'data-testid',
          'data-test-id',
          'data-qa',
          'data-qa-id'
        ]
      });
      observers.push(obs);
    } catch {
      // ignore observe errors
    }

    for (const host of listShadowHosts(root)) {
      const hostEl = host as HTMLElement & { shadowRoot?: ShadowRoot | null };
      const sr = hostEl.shadowRoot ?? null;
      if (sr) observeRoot(sr);
    }
    for (const frame of listSameOriginFrames(root)) {
      try {
        const doc = frame.contentDocument;
        if (doc) observeRoot(doc);
      } catch {
        // ignore
      }
    }
  }

  observeRoot(document);

  const periodicCheck = window.setInterval(() => {
    try {
      observeRoot(document);
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
      scanVersion = 0;
    },
    rescanNow: () => throttler.flush()
  };
}
