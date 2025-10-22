import { z } from 'zod';
import {
  UniversalDataSchema,
  type CanonicalPath,
  type UniversalData,
  IdentitySchema,
  ContactSchema,
  AddressSchema,
  OrganizationSchema,
  WebPresenceSchema,
  MessageSchema
} from './universal';
import type { SynonymMap } from './synonyms';

export interface ScenarioProfile {
  id: 'WebsiteSubmission' | 'JobApplication' | string;
  label: string;
  description?: string;
  required: CanonicalPath[];
  preferred?: CanonicalPath[];
  synonymsOverlay?: Partial<SynonymMap['aliases']>;
}

export const WebsiteSubmissionProfile: ScenarioProfile = {
  id: 'WebsiteSubmission',
  label: 'Website Contact Submission',
  description:
    'Typical website contact form including name, email, phone and message with optional company and website fields.',
  required: [
    'message.body',
    'contact.email'
  ],
  preferred: [
    'identity.fullName',
    'identity.firstName',
    'identity.lastName',
    'contact.phone',
    'organization.name',
    'webPresence.websiteUrl',
    'message.subject'
  ],
  synonymsOverlay: {
    'message.body': ['message', 'your message', 'comments', 'inquiry'],
    'message.subject': ['subject', 'topic'],
    'webPresence.websiteUrl': ['website', 'url', 'site']
  }
};

export const JobApplicationProfile: ScenarioProfile = {
  id: 'JobApplication',
  label: 'Job Application',
  description:
    'Common job application fields: name, email, phone, company, role/title, and links to professional profiles.',
  required: [
    'identity.firstName',
    'identity.lastName',
    'contact.email',
    'contact.phone'
  ],
  preferred: [
    'identity.fullName',
    'organization.name',
    'organization.title',
    'webPresence.social.linkedin',
    'webPresence.social.github',
    'webPresence.websiteUrl',
    'message.body'
  ],
  synonymsOverlay: {
    'webPresence.social.linkedin': ['linkedin', 'linkedin profile'],
    'webPresence.social.github': ['github', 'github profile']
  }
};

export function profileSchema(profile: ScenarioProfile): z.ZodType<UniversalData> {
  // Start from universal but make required fields explicitly required
  let schema = UniversalDataSchema;

  // For performance and clarity, apply targeted overrides for common groups
  const forceRequired = (p: CanonicalPath) => {
    const [head, ...rest] = p.split('.');
    const tail = rest.join('.');
    switch (head) {
      case 'identity':
        schema = schema.extend({ identity: IdentitySchema.required() });
        break;
      case 'contact':
        schema = schema.extend({ contact: ContactSchema.required() });
        break;
      case 'address':
        schema = schema.extend({ address: AddressSchema.required() });
        break;
      case 'organization':
        schema = schema.extend({ organization: OrganizationSchema.required() });
        break;
      case 'webPresence':
        schema = schema.extend({ webPresence: WebPresenceSchema.required() });
        break;
      case 'message':
        schema = schema.extend({ message: MessageSchema.required() });
        break;
    }
    void tail; // we keep validation on the group level and rely on runtime field checks for inner props
  };

  profile.required.forEach(forceRequired);
  return schema;
}

export function listProfileFields(profile: ScenarioProfile): { required: CanonicalPath[]; preferred: CanonicalPath[] } {
  return {
    required: profile.required,
    preferred: profile.preferred || []
  };
}

export function applyProfileSynonyms(base: SynonymMap, profile: ScenarioProfile): SynonymMap {
  if (!profile.synonymsOverlay) return base;
  const mergedAliases: Record<string, string[]> = { ...base.aliases };
  for (const [k, arr] of Object.entries(profile.synonymsOverlay)) {
    const ex = mergedAliases[k] || [];
    mergedAliases[k] = Array.from(new Set([...ex, ...arr!]));
  }
  return { aliases: mergedAliases, multilingual: { ...base.multilingual } };
}

export const SCENARIO_PROFILES: Record<string, ScenarioProfile> = {
  [WebsiteSubmissionProfile.id]: WebsiteSubmissionProfile,
  [JobApplicationProfile.id]: JobApplicationProfile
};
