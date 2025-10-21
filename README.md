# AIAutoFill

Auto fill a form with AI.

This extension scans pages for form controls and now includes a deterministic + heuristic field matching engine to map detected fields to an ontology of common data keys (email, phone, names, address, etc.). The matcher provides ranked results with thresholds and detailed explanation artifacts suitable for UI highlighting.

Highlights:
- Deterministic rules: HTML `autocomplete` tokens, exact alias matches against id/name/class/label.
- Constraints: input type and optional regex patterns.
- Heuristics: synonyms, token overlap, and fuzzy string similarity.
- API: rank candidates for a key, rank keys for a candidate, and batch matching. Each match includes a score, tier (accept/consider/reject), and explanation artifacts with highlight hints.

## Dev

- `npm run dev` — Vite dev server for the extension
- `npm run build` — production build
- `npm run lint` — lint TypeScript and Svelte
- `npm run format` — Prettier

## Matching Engine API

Types live in `src/lib/ontology.ts` and `src/lib/fieldMatcher.ts`. The matcher consumes `Candidate` entries produced by `src/content/domScanner.ts`.

Basic usage:

```ts
import type { Candidate } from './content/domScanner';
import { rankCandidatesForKey, rankKeysForCandidate, computeBatchMatches } from './lib/fieldMatcher';
import { DEFAULT_MATCHER_CONFIG, type OntologyKey } from './lib/ontology';

const key: OntologyKey = {
  key: 'email',
  label: 'Email Address',
  aliases: ['e-mail', 'mail'],
  type: 'email',
  regexes: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/]
};

// candidates come from the DOM scanner
const candidates: Candidate[] = window.__AIAutoFill_lastScan__.candidates;

// Rank all candidates for a given ontology key
const ranked = rankCandidatesForKey(key, candidates, DEFAULT_MATCHER_CONFIG);

// Or rank ontology keys for a specific candidate
const resultsForOne = rankKeysForCandidate(candidates[0], [key], DEFAULT_MATCHER_CONFIG);

// Or compute batch mappings for many keys and candidates
const batch = computeBatchMatches([key], candidates, DEFAULT_MATCHER_CONFIG);

console.log(ranked[0].score, ranked[0].tier, ranked[0].explanation);
```

### Scores, tiers, and explanations

- Score: 0..1 combining weighted heuristic contributions (deterministic and fuzzy). Default weights and thresholds can be tuned.
- Tier: derived from thresholds: `accept` (>= 0.85), `consider` (>= 0.6), `reject` otherwise.
- Explanation: includes per-heuristic contributions and `highlights` with matched tokens to drive UI highlighting.

### Configuration

Default config is exported as `DEFAULT_MATCHER_CONFIG`, which includes:
- `weights`: contribution weights for the heuristics
- `thresholds`: accept/consider/visibleFloor
- `autocompleteMap`: maps HTML autocomplete tokens to ontology keys
- `synonyms`: basic synonyms for ontology keys used by schema hints

You can pass a partial override to any matcher function to adjust behavior per use case.

### Optional semantic matching (external embeddings)

The extension can optionally use an external embeddings API (MiniLM/TinyBERT or compatible) to add a semantic matching contribution and rerank results. This is disabled by default.

When enabled, only minimal context (labels only) is sent to the embeddings service:
- Ontology key labels (e.g., "Email", "Phone")
- Detected field labels (accessible names) from the page

No field values or broader page content is sent. Requests are batched and embeddings are cached in-memory with a TTL. If the service is unavailable or offline, the extension gracefully falls back to local heuristics.

Configure via environment variables (Vite dev/build):
- `VITE_SEMANTIC_ENABLED=true` — enable semantic matching
- `VITE_EMBEDDINGS_URL=https://your-embeddings-endpoint` — POST endpoint that returns embeddings
- `VITE_EMBEDDINGS_MODEL=MiniLM` — optional model name (`MiniLM`/`TinyBERT`/custom)
- `VITE_EMBEDDINGS_API_KEY=...` — optional bearer token
- `VITE_EMBEDDINGS_BATCH_SIZE=64` — optional batch size
- `VITE_EMBEDDINGS_TIMEOUT_MS=4000` — optional request timeout
- `VITE_EMBEDDINGS_CACHE_TTL_MS=86400000` — optional cache TTL (ms)
- `VITE_SEMANTIC_WEIGHT=0.6` — optional weight for semantic contribution [0..1]

API contract (flexible): The endpoint should accept a JSON payload like `{ model, input: string[] }` and return either `{ embeddings: number[][] }`, `{ vectors: number[][] }`, or `{ data: [{ embedding: number[] }, ...] }` with one vector per input string.

See PRIVACY.md for details about privacy, batching, and offline behavior.

## Universal Data Ontology (Zod)

A universal, extensible ontology covering Identity, Contact, Address, Organization, WebPresence, SEO, BusinessListing, Message, Credentials, and Custom is available under `src/lib/universal.ts` and exported from `src/lib/index.ts`.

Example:

```ts
import { IdentitySchema, UniversalDataSchema } from './src/lib';

const identity = IdentitySchema.parse({ firstName: 'Ada', lastName: 'Lovelace' });

const data = UniversalDataSchema.parse({
  identity,
  contact: { email: 'ada@example.org' },
  webPresence: { websiteUrl: 'https://example.org' }
});
```

## Synonyms and Aliases (multilingual)

Multilingual synonym maps and field aliases for canonical field paths live in `src/lib/synonyms.ts`.

- `UNIVERSAL_SYNONYMS`: default mappings
- `buildAliasIndex(map, locale?)`: build a fast lookup index
- `resolveCanonical(name, locale?)`: resolve a label/alias to a canonical field path

```ts
import { resolveCanonical } from './src/lib';

resolveCanonical('Correo electrónico', 'es'); // => 'contact.email'
```

## Normalization utilities

Utilities for email, URL, and phone normalization are provided in `src/lib/normalize.ts`.

```ts
import { normalizeEmail, normalizeUrl, normalizePhone, normalizeByFieldPath } from './src/lib';

normalizeEmail('  MAILTO:User@Example.COM  '); // 'user@example.com'
normalizeUrl('example.com/?utm_source=x#frag'); // 'https://example.com/'
normalizePhone('(415) 555-1212', { defaultCountry: 'US' }); // '+14155551212'
normalizeByFieldPath('contact.email', ' User@Example.com '); // 'user@example.com'
```

## Scenario profiles (declarative overlays)

Two scenario profiles are defined in `src/lib/profiles.ts`:
- `WebsiteSubmission` — typical website contact forms (requires `message.body` and `contact.email`)
- `JobApplication` — job application forms (requires identity + contact basics)

Each profile exposes:
- `required`: canonical field paths that should be populated
- `preferred`: additional, nice-to-have fields
- `synonymsOverlay`: additional aliases to aid matching in that scenario

APIs:

```ts
import { SCENARIO_PROFILES, profileSchema, applyProfileSynonyms, UNIVERSAL_SYNONYMS } from './src/lib';

const profile = SCENARIO_PROFILES.WebsiteSubmission;
const schema = profileSchema(profile); // Zod schema with required groups
const synonymsForScenario = applyProfileSynonyms(UNIVERSAL_SYNONYMS, profile);
```

