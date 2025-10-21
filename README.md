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

