import type { OntologyKey } from '../../lib/ontology';

export const DEFAULT_KEYS: OntologyKey[] = [
  { key: 'email', label: 'Email', type: 'email', regexes: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/] },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'name', label: 'Full Name', type: 'name' },
  { key: 'given-name', label: 'First Name', type: 'given-name' },
  { key: 'family-name', label: 'Last Name', type: 'family-name' },
  { key: 'organization', label: 'Organization', type: 'organization' },
  { key: 'website-url', label: 'Website', type: 'text' },
  { key: 'message.body', label: 'Message', type: 'text' }
];

export const DEFAULT_VALUES: Record<string, unknown> = {
  email: 'ada@example.org',
  phone: '+1 415-555-2671',
  name: 'Ada Lovelace',
  'given-name': 'Ada',
  'family-name': 'Lovelace',
  organization: 'Analytical Engines Inc.',
  'website-url': 'https://example.org',
  'message.body': "Hello! I'm interested in your product. Could you share more details?"
};

export const SYNONYMS_OVERLAY: Record<string, string[]> = {
  'website-url': ['website', 'site', 'url', 'homepage', 'web address'],
  'message.body': ['message', 'your message', 'comments', 'inquiry', 'question']
};
