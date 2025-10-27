export interface TextScannerOptions {
  maxNodes?: number;
  minChars?: number;
  includeSelectors?: string[];
  excludeSelectors?: string[];
  dedupe?: boolean;
}

export interface TextSegment {
  text: string;
  element: Element;
  path: string;
  weight: number;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  tagName: string;
  depth: number;
}

const DEFAULT_MAX_NODES = 800;
const DEFAULT_MIN_CHARS = 3;
const EXCLUDED_TAGS = new Set<string>(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'HEAD']);
const EXCLUDED_ROLES = new Set<string>(['presentation', 'none']);
const CONTENT_PREFERRED_SELECTORS = ['main', 'article', '[role="main"]', '.content', '.main', '.profile', '.contact', '.card'];
const DOWNWEIGHT_SELECTORS = ['header', 'nav', 'footer', 'aside', '.sidebar', '.breadcrumbs', '.menu'];

const visibilityCache = new WeakMap<Element, boolean>();

function isElementExcluded(element: Element, excludeSelectors?: string[]): boolean {
  if (!element) return true;
  if (EXCLUDED_TAGS.has(element.tagName)) return true;
  if (element.closest('script, style, noscript, template, svg, iframe, canvas')) return true;
  if (element instanceof HTMLElement) {
    if (element.hidden || element.dataset?.aiafIgnore === 'true') return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
  }
  if (excludeSelectors && excludeSelectors.length) {
    for (const selector of excludeSelectors) {
      try {
        if (element.closest(selector)) return true;
      } catch (error) {
        void error;
      }
    }
  }
  return false;
}

function isElementVisible(element: Element): boolean {
  const cached = visibilityCache.get(element);
  if (cached != null) return cached;
  if (!(element instanceof HTMLElement)) {
    visibilityCache.set(element, false);
    return false;
  }
  if (!element.isConnected) {
    visibilityCache.set(element, false);
    return false;
  }
  if (element.hidden) {
    visibilityCache.set(element, false);
    return false;
  }
  let current: HTMLElement | null = element;
  while (current) {
    if (current.dataset?.aiafIgnore === 'true') {
      visibilityCache.set(element, false);
      return false;
    }
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      visibilityCache.set(element, false);
      return false;
    }
    current = current.parentElement;
  }
  const rect = element.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0;
  visibilityCache.set(element, visible);
  return visible;
}

function getDomDepth(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current && current !== document.body && depth < 64) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function cssFragmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) {
    return `${tag}#${element.id}`;
  }
  const classList = Array.from(element.classList)
    .map((cls) => cls.trim())
    .filter(Boolean)
    .slice(0, 2);
  let fragment = tag;
  if (classList.length) {
    fragment += '.' + classList.join('.');
  }
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((child) => (child as Element).tagName === element.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1;
      fragment += `:nth-of-type(${index})`;
    }
  }
  return fragment;
}

function computeDomPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && segments.length < 6) {
    segments.unshift(cssFragmentFor(current));
    if (current.id) break;
    current = current.parentElement;
  }
  if (current === document.body) {
    segments.unshift('body');
  }
  return segments.join(' > ');
}

export function describeElementPath(element: Element): string {
  return computeDomPath(element);
}

function computeWeight(element: Element): number {
  let weight = 1;
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    weight += 2 - Math.min(1.5, (Number(tag[1]) - 1) * 0.25);
  }
  if (tag === 'p' || tag === 'li' || tag === 'div' || tag === 'span') {
    weight += 0.2;
  }
  for (const selector of CONTENT_PREFERRED_SELECTORS) {
    try {
      if (element.closest(selector)) {
        weight += 1.2;
        break;
      }
    } catch (error) {
      void error;
    }
  }
  for (const selector of DOWNWEIGHT_SELECTORS) {
    try {
      if (element.closest(selector)) {
        weight *= 0.5;
        break;
      }
    } catch (error) {
      void error;
    }
  }
  if (EXCLUDED_ROLES.has(element.getAttribute('role') || '')) {
    weight *= 0.5;
  }
  if (weight < 0.05) weight = 0.05;
  return weight;
}

function normaliseText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scanVisibleTextNodes(options: TextScannerOptions = {}): TextSegment[] {
  const root = document.body;
  if (!root) return [];
  const maxNodes = Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES);
  const minChars = Math.max(1, options.minChars ?? DEFAULT_MIN_CHARS);
  const includeSelectors = options.includeSelectors || [];
  const excludeSelectors = options.excludeSelectors || [];
  const dedupe = options.dedupe !== false;

  const segments: TextSegment[] = [];
  const seen = new Map<string, TextSegment>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_SKIP;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_SKIP;
      if (isElementExcluded(parent, excludeSelectors)) return NodeFilter.FILTER_SKIP;
      const text = normaliseText(node.textContent || '');
      if (text.length < minChars) return NodeFilter.FILTER_SKIP;
      if (!isElementVisible(parent)) return NodeFilter.FILTER_SKIP;
      if (includeSelectors.length) {
        let matches = false;
        for (const selector of includeSelectors) {
          try {
            if (parent.closest(selector)) {
              matches = true;
              break;
            }
          } catch (error) {
            void error;
          }
        }
        if (!matches) return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (segments.length < maxNodes) {
    const node = walker.nextNode() as Text | null;
    if (!node) break;
    const parent = node.parentElement;
    if (!parent) continue;
    const text = normaliseText(node.textContent || '');
    if (!text) continue;
    const rect = parent.getBoundingClientRect();
    const segment: TextSegment = {
      text,
      element: parent,
      path: describeElementPath(parent),
      weight: computeWeight(parent),
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      },
      tagName: parent.tagName.toLowerCase(),
      depth: getDomDepth(parent)
    };
    const key = dedupe ? `${segment.path}|${segment.text}` : '';
    if (dedupe && key) {
      const existing = seen.get(key);
      if (existing) {
        if (segment.weight > existing.weight) {
          seen.set(key, segment);
        }
        continue;
      }
      seen.set(key, segment);
    }
    segments.push(segment);
  }

  if (dedupe) {
    return Array.from(seen.values()).sort((a, b) => b.weight - a.weight);
  }
  return segments.sort((a, b) => b.weight - a.weight);
}
