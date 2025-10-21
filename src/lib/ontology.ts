export type OntologyKeyType =
  | 'text'
  | 'email'
  | 'phone'
  | 'name'
  | 'given-name'
  | 'family-name'
  | 'address-line1'
  | 'address-line2'
  | 'city'
  | 'region'
  | 'postal-code'
  | 'country'
  | 'company'
  | 'organization'
  | 'credit-card-number'
  | 'date'
  | 'number';

export interface OntologyKey {
  // Canonical identifier for the field in the ontology (e.g., 'email', 'phone', 'address-line1')
  key: string;
  // Human readable name
  label?: string;
  // Common alias strings for strict/deterministic matching (e.g., ['email', 'e-mail', 'mail'])
  aliases?: string[];
  // Expected semantic type used for type/regex constraints
  type?: OntologyKeyType;
  // Optional regex strings that valid values should match
  regexes?: (string | RegExp)[];
}

export interface MatcherThresholds {
  // If score >= accept, it is a strong match
  accept: number; // default 0.85
  // If score >= consider, it is a candidate to consider
  consider: number; // default 0.6
  // Below this we hide in UI by default
  visibleFloor: number; // default 0.3
}

export interface MatcherWeights {
  deterministicAutocomplete: number; // default 1.0
  deterministicAlias: number; // default 0.95
  typeConstraint: number; // default 0.4
  regexConstraint: number; // default 0.5
  schemaHint: number; // default 0.3
  fuzzy: number; // default 0.7
}

export interface MatcherConfig {
  thresholds: MatcherThresholds;
  weights: MatcherWeights;
  // Map of HTML autocomplete tokens to ontology keys
  autocompleteMap?: Record<string, string>;
  // Map of ontology key -> set of synonyms, used by schemaHint heuristic
  synonyms?: Record<string, string[]>;
}

export const DEFAULT_AUTOCOMPLETE_MAP: Record<string, string> = {
  // Identity
  name: 'name',
  'given-name': 'given-name',
  'additional-name': 'middle-name',
  'family-name': 'family-name',
  nickname: 'name',
  username: 'name',
  'organization-title': 'job-title',
  organization: 'organization',
  company: 'company',
  // Contact
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'tel-country-code': 'phone',
  'tel-area-code': 'phone',
  // Address
  'street-address': 'address-line1',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-level1': 'region',
  'address-level2': 'city',
  'postal-code': 'postal-code',
  country: 'country',
  'country-name': 'country',
  // Payment
  'cc-number': 'credit-card-number'
};

export const DEFAULT_SYNONYMS: Record<string, string[]> = {
  email: ['email', 'e-mail', 'mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'cellphone', 'phone number', 'contact number'],
  name: ['name', 'full name'],
  'given-name': ['first name', 'given name', 'forename'],
  'family-name': ['last name', 'surname', 'family name'],
  company: ['company', 'employer', 'workplace', 'organization'],
  organization: ['organization', 'org', 'institution', 'company'],
  'address-line1': ['address', 'street', 'street address', 'address line 1', 'addr1'],
  'address-line2': ['address line 2', 'addr2', 'suite', 'apartment', 'apt'],
  city: ['city', 'town', 'locality'],
  region: ['state', 'province', 'region', 'county'],
  'postal-code': ['postal code', 'postcode', 'zip', 'zip code'],
  country: ['country', 'nation'],
  'credit-card-number': ['credit card', 'card number', 'cc', 'cc number'],
  date: ['date', 'dob', 'date of birth'],
  number: ['number', 'qty', 'quantity', 'amount']
};

export const DEFAULT_THRESHOLDS: MatcherThresholds = {
  accept: 0.85,
  consider: 0.6,
  visibleFloor: 0.3
};

export const DEFAULT_WEIGHTS: MatcherWeights = {
  deterministicAutocomplete: 1.0,
  deterministicAlias: 0.95,
  typeConstraint: 0.4,
  regexConstraint: 0.5,
  schemaHint: 0.3,
  fuzzy: 0.7
};

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  weights: DEFAULT_WEIGHTS,
  autocompleteMap: DEFAULT_AUTOCOMPLETE_MAP,
  synonyms: DEFAULT_SYNONYMS
};
