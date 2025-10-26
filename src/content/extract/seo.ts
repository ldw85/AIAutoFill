import type { Mode } from '../../core/model/schemas';

const SUMMARY_DEFAULT_MAX_LENGTH = 260;
const KEYWORD_DEFAULT_LIMIT = 12;
const SUMMARY_TIMEOUT_MS = 3500;
const SUMMARY_MAX_CONTEXT = 1200;
const MIN_PARAGRAPH_LENGTH = 40;
const STOPWORDS = new Set<string>([
  'the',
  'and',
  'for',
  'are',
  'with',
  'that',
  'from',
  'this',
  'have',
  'will',
  'your',
  'about',
  'into',
  'more',
  'than',
  'when',
  'what',
  'where',
  'which',
  'using',
  'used',
  'also',
  'their',
  'each',
  'being',
  'over',
  'such',
  'only',
  'other',
  'some',
  'most',
  'many',
  'much',
  'very',
  'here',
  'there',
  'they',
  'them',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'was',
  'were',
  'been',
  'after',
  'before',
  'because',
  'while',
  'among',
  'between',
  'within',
  'without',
  'through',
  'during',
  'upon',
  'onto',
  'again',
  'further',
  'ever',
  'every',
  'each',
  'same',
  'just',
  'like',
  'make',
  'made',
  'back',
  'even',
  'still',
  'can',
  'could',
  'should',
  'would',
  'may',
  'might',
  'must',
  'does',
  'doing',
  'done',
  'did',
  'say',
  'says',
  'said',
  'get',
  'gets',
  'got',
  'one',
  'two',
  'three',
  'four',
  'five',
  'well',
  'best',
  'new',
  'news',
  'press',
  'release',
  'blog',
  'post',
  'into',
  'via',
  'much',
  'really',
  'every',
  'those',
  'these',
  'any',
  'each',
  'once'
]);

const summaryApiKey = (import.meta.env.VITE_SEO_SUMMARY_API_KEY as string | undefined) || undefined;

export interface SeoFieldValue {
  value: string;
  source: string;
}

export interface SeoExtractionResult {
  fields: Record<string, SeoFieldValue>;
  suggestedKeywords: string[];
  keywordsSource: string;
  descriptionSource: string;
  usedSemantic: boolean;
  fallbackParagraph?: string;
  meta: {
    title?: string;
    ogTitle?: string;
    twitterTitle?: string;
    metaDescription?: string;
    ogDescription?: string;
    twitterDescription?: string;
    canonicalUrl?: string;
    ogUrl?: string;
    metaKeywords?: string[];
  };
}

export interface SemanticEnhancementOptions {
  active: boolean;
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxLength?: number;
}

export interface SeoExtractionOptions {
  mode?: Mode;
  descriptionMaxLength?: number;
  keywordLimit?: number;
  semanticEnhancement?: SemanticEnhancementOptions;
}

function normaliseWhitespace(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryMetaContent(attr: 'name' | 'property' | 'itemprop', value: string): string {
  const selector = `meta[${attr}="${value}" i]`;
  const head = document.head || document;
  const element = head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) return '';
  const content = element.getAttribute('content');
  return normaliseWhitespace(content);
}

function queryLinkHref(rel: string): string {
  const selector = `link[rel="${rel}" i]`;
  const element = (document.head || document).querySelector(selector) as HTMLLinkElement | null;
  const href = element?.getAttribute('href');
  return normaliseWhitespace(href);
}

function toAbsoluteUrl(href: string | null | undefined): string {
  const raw = normaliseWhitespace(href);
  if (!raw) return '';
  try {
    return new URL(raw, document.baseURI || window.location.href).toString();
  } catch (error) {
    void error;
    return raw;
  }
}

function isMeaningfulParagraph(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest('header, nav, footer, form, aside, figure, svg')) return false;
  const text = normaliseWhitespace(element.textContent);
  if (text.length < MIN_PARAGRAPH_LENGTH) return false;
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
  } catch (error) {
    void error;
  }
  const rect = element.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return false;
  return true;
}

function collectParagraphTexts(limit = 6): string[] {
  const paragraphs: string[] = [];
  const candidates = document.querySelectorAll('main p, article p, section p, body p');
  for (const node of Array.from(candidates)) {
    if (!isMeaningfulParagraph(node)) continue;
    const text = normaliseWhitespace(node.textContent);
    if (!text) continue;
    paragraphs.push(text);
    if (paragraphs.length >= limit) break;
  }
  return paragraphs;
}

function summariseText(text: string, maxLength: number): string {
  const normalised = normaliseWhitespace(text);
  if (!normalised) return '';
  if (normalised.length <= maxLength) return normalised;
  const truncated = normalised.slice(0, maxLength + 1);
  const sentenceDelimiters = ['. ', '! ', '? '];
  let cutIndex = -1;
  for (const delimiter of sentenceDelimiters) {
    const idx = truncated.lastIndexOf(delimiter);
    if (idx > cutIndex) cutIndex = idx + delimiter.trim().length;
  }
  if (cutIndex >= MIN_PARAGRAPH_LENGTH) {
    return normaliseWhitespace(truncated.slice(0, cutIndex));
  }
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > MIN_PARAGRAPH_LENGTH) {
    return `${normaliseWhitespace(truncated.slice(0, lastSpace))}…`;
  }
  return `${truncated.trim()}…`;
}

function tokenise(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g);
  if (!matches) return [];
  return matches
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function suggestKeywords(paragraphs: string[], limit: number): string[] {
  const freq = new Map<string, number>();
  for (const paragraph of paragraphs) {
    for (const token of tokenise(paragraph)) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }
  const entries = Array.from(freq.entries());
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.slice(0, limit).map(([word]) => word);
}

async function semanticSummarise(text: string, options: SemanticEnhancementOptions): Promise<string | null> {
  if (!options.endpoint || typeof fetch !== 'function') return null;
  const payload = {
    text: text.slice(0, SUMMARY_MAX_CONTEXT),
    maxLength: options.maxLength ?? SUMMARY_DEFAULT_MAX_LENGTH
  } satisfies Record<string, unknown>;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = options.apiKey || summaryApiKey;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as unknown;
      if (typeof data === 'string') return normaliseWhitespace(data);
      if (data && typeof (data as { summary?: unknown }).summary === 'string') {
        return normaliseWhitespace((data as { summary: string }).summary);
      }
      const firstChoice = (data as { choices?: Array<{ text?: string; message?: { content?: string } }> }).choices?.[0];
      if (firstChoice?.text) return normaliseWhitespace(firstChoice.text);
      if (firstChoice?.message?.content) return normaliseWhitespace(firstChoice.message.content);
      return null;
    }
    const textResponse = await response.text();
    return normaliseWhitespace(textResponse);
  } catch (error) {
    console.warn('[AIAutoFill] semantic summary failed; using local summary instead', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function firstNonEmpty(
  candidates: Array<{ value: string; source: string }>
): { value: string; source: string } | null {
  for (const candidate of candidates) {
    const value = normaliseWhitespace(candidate.value);
    if (value) {
      return { value, source: candidate.source };
    }
  }
  return null;
}

function parseMetaKeywords(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((chunk) => normaliseWhitespace(chunk))
    .filter((chunk, index, self) => chunk.length > 0 && self.indexOf(chunk) === index);
}

export async function extractSeoMetadata(options?: SeoExtractionOptions): Promise<SeoExtractionResult> {
  const descriptionMaxLength = options?.descriptionMaxLength ?? SUMMARY_DEFAULT_MAX_LENGTH;
  const keywordLimit = options?.keywordLimit ?? KEYWORD_DEFAULT_LIMIT;
  const semanticOpts = options?.semanticEnhancement;

  const documentTitle = normaliseWhitespace(document.title);
  const ogTitle = queryMetaContent('property', 'og:title');
  const twitterTitle = queryMetaContent('name', 'twitter:title');

  const metaDescription = queryMetaContent('name', 'description');
  const ogDescription = queryMetaContent('property', 'og:description');
  const twitterDescription = queryMetaContent('name', 'twitter:description');

  const canonicalUrlRaw = queryLinkHref('canonical');
  const ogUrlRaw = queryMetaContent('property', 'og:url');
  const canonicalUrl = toAbsoluteUrl(canonicalUrlRaw);
  const ogUrl = toAbsoluteUrl(ogUrlRaw);
  const pageUrl = canonicalUrl || ogUrl || window.location.href;
  const pageUrlSource = canonicalUrl ? 'link[rel="canonical"]' : ogUrl ? 'meta[property="og:url"]' : 'location.href';

  const metaKeywordsRaw = queryMetaContent('name', 'keywords');
  const metaKeywords = parseMetaKeywords(metaKeywordsRaw);

  const paragraphs = collectParagraphTexts();
  const fallbackParagraph = paragraphs[0] || '';
  const fallbackSummary = fallbackParagraph ? summariseText(fallbackParagraph, descriptionMaxLength) : '';

  let usedSemantic = false;
  let descriptionSource = 'meta[name="description"]';

  let descriptionCandidate = firstNonEmpty([
    { value: metaDescription, source: 'meta[name="description"]' },
    { value: ogDescription, source: 'meta[property="og:description"]' },
    { value: twitterDescription, source: 'meta[name="twitter:description"]' },
    { value: fallbackSummary, source: 'first-paragraph' }
  ]);

  if (!descriptionCandidate) {
    descriptionCandidate = { value: '', source: 'unavailable' };
  } else if (
    descriptionCandidate.source === 'first-paragraph' &&
    semanticOpts?.active &&
    semanticOpts.endpoint &&
    (options?.mode === 'semantic' || semanticOpts.active)
  ) {
    const semanticInput = paragraphs.slice(0, 3).join('\n\n');
    const semanticSummary = await semanticSummarise(semanticInput, semanticOpts);
    if (semanticSummary) {
      descriptionCandidate = { value: semanticSummary, source: 'semantic-summary' };
      usedSemantic = true;
    }
  }
  descriptionSource = descriptionCandidate.source;

  let keywordsSource = 'meta[name="keywords"]';
  const suggestedKeywords = suggestKeywords(paragraphs, keywordLimit);
  let keywordsValue = '';
  if (metaKeywords.length) {
    keywordsValue = metaKeywords.join(', ');
  } else if (suggestedKeywords.length) {
    keywordsSource = 'keyword-frequency';
    keywordsValue = suggestedKeywords.join(', ');
  }

  const titleCandidate = firstNonEmpty([
    { value: ogTitle, source: 'meta[property="og:title"]' },
    { value: twitterTitle, source: 'meta[name="twitter:title"]' },
    { value: documentTitle, source: 'document.title' }
  ]);
  const titleValue = titleCandidate?.value || '';
  const titleSource = titleCandidate?.source || (documentTitle ? 'document.title' : 'unknown');

  const fields: Record<string, SeoFieldValue> = {};
  if (pageUrl) fields['web.url'] = { value: pageUrl, source: pageUrlSource };
  if (titleValue) fields['web.site_title'] = { value: titleValue, source: titleSource };
  if (descriptionCandidate.value) fields['web.description'] = { value: descriptionCandidate.value, source: descriptionSource };
  if (keywordsValue) fields['web.keywords'] = { value: keywordsValue, source: keywordsSource };
  if (canonicalUrl) fields['web.canonical_url'] = { value: canonicalUrl, source: 'link[rel="canonical"]' };
  if (ogTitle) fields['web.og_title'] = { value: ogTitle, source: 'meta[property="og:title"]' };
  if (ogDescription) fields['web.og_description'] = { value: ogDescription, source: 'meta[property="og:description"]' };

  return {
    fields,
    suggestedKeywords,
    keywordsSource,
    descriptionSource,
    usedSemantic,
    fallbackParagraph: fallbackParagraph || undefined,
    meta: {
      title: documentTitle || undefined,
      ogTitle: ogTitle || undefined,
      twitterTitle: twitterTitle || undefined,
      metaDescription: metaDescription || undefined,
      ogDescription: ogDescription || undefined,
      twitterDescription: twitterDescription || undefined,
      canonicalUrl: canonicalUrl || undefined,
      ogUrl: ogUrl || undefined,
      metaKeywords: metaKeywords.length ? metaKeywords : undefined
    }
  };
}
