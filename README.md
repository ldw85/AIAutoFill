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

