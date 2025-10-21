import { z } from 'zod';

// Core entity schemas
export const IdentitySchema = z
  .object({
    salutation: z.string().trim().min(1).optional(),
    firstName: z.string().trim().min(1).optional(),
    middleName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    suffix: z.string().trim().min(1).optional(),
    fullName: z.string().trim().min(1).optional(),
    preferredName: z.string().trim().min(1).optional(),
    pronouns: z.string().trim().min(1).optional(),
    gender: z
      .enum(['male', 'female', 'non-binary', 'other', 'prefer-not-to-say'])
      .optional(),
    dateOfBirth: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})$/, 'Expected ISO date YYYY-MM-DD')
      .optional()
  })
  .describe('Personal identity fields');

export type Identity = z.infer<typeof IdentitySchema>;

export const ContactSchema = z
  .object({
    email: z.string().email().optional(),
    altEmails: z.array(z.string().email()).optional(),
    phone: z.string().min(3).optional(),
    altPhones: z.array(z.string().min(3)).optional(),
    fax: z.string().min(3).optional(),
    preferredContactMethod: z
      .enum(['email', 'phone', 'sms', 'whatsapp', 'telegram', 'signal'])
      .optional()
  })
  .describe('Contact-related fields');

export type Contact = z.infer<typeof ContactSchema>;

export const GeoSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })
  .describe('Geographic coordinates');

export type Geo = z.infer<typeof GeoSchema>;

export const AddressSchema = z
  .object({
    street1: z.string().trim().min(1).optional(),
    street2: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).optional(),
    region: z.string().trim().min(1).optional(),
    postalCode: z.string().trim().min(1).optional(),
    country: z.string().trim().min(1).optional(),
    countryCode: z.string().trim().length(2).optional(),
    formatted: z.string().trim().min(1).optional(),
    geo: GeoSchema.optional()
  })
  .describe('Postal address fields');

export type Address = z.infer<typeof AddressSchema>;

export const OrganizationSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    legalName: z.string().trim().min(1).optional(),
    dba: z.string().trim().min(1).optional(),
    department: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).optional(),
    employeeId: z.string().trim().min(1).optional(),
    taxId: z.string().trim().min(1).optional(),
    industry: z.string().trim().min(1).optional(),
    size: z.union([z.string(), z.number()]).optional(),
    website: z.string().url().optional(),
    address: AddressSchema.optional(),
    phone: z.string().min(3).optional(),
    email: z.string().email().optional()
  })
  .describe('Organization/company-related fields');

export type Organization = z.infer<typeof OrganizationSchema>;

export const SocialHandlesSchema = z
  .object({
    twitter: z.string().url().optional(),
    x: z.string().url().optional(),
    linkedin: z.string().url().optional(),
    github: z.string().url().optional(),
    facebook: z.string().url().optional(),
    instagram: z.string().url().optional(),
    youtube: z.string().url().optional(),
    tiktok: z.string().url().optional(),
    mastodon: z.string().url().optional(),
    medium: z.string().url().optional(),
    pinterest: z.string().url().optional(),
    discord: z.string().url().optional(),
    telegram: z.string().url().optional(),
    whatsapp: z.string().url().optional()
  })
  .partial()
  .describe('Common social profile URLs');

export type SocialHandles = z.infer<typeof SocialHandlesSchema>;

export const WebPresenceSchema = z
  .object({
    websiteUrl: z.string().url().optional(),
    profileUrl: z.string().url().optional(),
    blogUrl: z.string().url().optional(),
    avatarUrl: z.string().url().optional(),
    rssUrl: z.string().url().optional(),
    social: SocialHandlesSchema.optional()
  })
  .describe('Web presence and identity');

export type WebPresence = z.infer<typeof WebPresenceSchema>;

export const SEOSchema = z
  .object({
    metaTitle: z.string().trim().min(1).optional(),
    metaDescription: z.string().trim().min(1).optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
    canonicalUrl: z.string().url().optional(),
    ogTitle: z.string().trim().min(1).optional(),
    ogDescription: z.string().trim().min(1).optional(),
    ogImage: z.string().url().optional(),
    robots: z.string().trim().min(1).optional()
  })
  .describe('SEO-related metadata');

export type SEO = z.infer<typeof SEOSchema>;

export const BusinessHoursSchema = z
  .object({
    dayOfWeek: z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
    open: z.string().optional(), // HH:MM 24h
    close: z.string().optional()
  })
  .describe('Single day opening hours');

export const BusinessListingSchema = z
  .object({
    businessName: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    subcategories: z.array(z.string().trim().min(1)).optional(),
    description: z.string().trim().min(1).optional(),
    yearEstablished: z.number().int().positive().optional(),
    licenseNumber: z.string().trim().min(1).optional(),
    priceRange: z.string().trim().min(1).optional(),
    services: z.array(z.string().trim().min(1)).optional(),
    paymentMethods: z.array(z.string().trim().min(1)).optional(),
    serviceArea: z.array(z.string().trim().min(1)).optional(),
    hours: z.array(BusinessHoursSchema).optional(),
    photos: z.array(z.string().url()).optional(),
    logoUrl: z.string().url().optional(),
    address: AddressSchema.optional(),
    phone: z.string().min(3).optional(),
    email: z.string().email().optional(),
    website: z.string().url().optional()
  })
  .describe('Public business listing information');

export type BusinessListing = z.infer<typeof BusinessListingSchema>;

export const AttachmentSchema = z
  .object({
    filename: z.string().trim().min(1),
    mimeType: z.string().trim().min(1).optional(),
    url: z.string().url().optional()
  })
  .describe('Attachment metadata');

export type Attachment = z.infer<typeof AttachmentSchema>;

export const MessageSchema = z
  .object({
    subject: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
    attachments: z.array(AttachmentSchema).optional(),
    inquiryType: z.string().trim().min(1).optional(),
    preferredDateTime: z.string().trim().min(1).optional()
  })
  .describe('Message body and subject for contact forms');

export type Message = z.infer<typeof MessageSchema>;

export const CredentialsSchema = z
  .object({
    username: z.string().trim().min(1).optional(),
    password: z.string().trim().min(1).optional(),
    otp: z.string().trim().min(1).optional(),
    oauthProvider: z.string().trim().min(1).optional(),
    apiKey: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1).optional()
  })
  .describe('Credentials or authentication artifacts - avoid persisting secrets');

export type Credentials = z.infer<typeof CredentialsSchema>;

export const CustomSchema = z
  .object({
    fields: z.record(z.any()).default({})
  })
  .describe('Arbitrary custom fields not covered by the core ontology');

export type Custom = z.infer<typeof CustomSchema>;

export const UniversalDataSchema = z
  .object({
    identity: IdentitySchema.optional(),
    contact: ContactSchema.optional(),
    address: AddressSchema.optional(),
    organization: OrganizationSchema.optional(),
    webPresence: WebPresenceSchema.optional(),
    seo: SEOSchema.optional(),
    businessListing: BusinessListingSchema.optional(),
    message: MessageSchema.optional(),
    credentials: CredentialsSchema.optional(),
    custom: CustomSchema.optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    notes: z.string().trim().min(1).optional()
  })
  .describe('Universal, extensible ontology for common autofill scenarios');

export type UniversalData = z.infer<typeof UniversalDataSchema>;

// Helper to generate a reduced schema by selecting specific paths
export type CanonicalPath =
  | 'identity.salutation'
  | 'identity.firstName'
  | 'identity.middleName'
  | 'identity.lastName'
  | 'identity.suffix'
  | 'identity.fullName'
  | 'identity.preferredName'
  | 'identity.pronouns'
  | 'identity.gender'
  | 'identity.dateOfBirth'
  | 'contact.email'
  | 'contact.altEmails'
  | 'contact.phone'
  | 'contact.altPhones'
  | 'contact.fax'
  | 'contact.preferredContactMethod'
  | 'address.street1'
  | 'address.street2'
  | 'address.city'
  | 'address.region'
  | 'address.postalCode'
  | 'address.country'
  | 'address.countryCode'
  | 'address.formatted'
  | 'organization.name'
  | 'organization.legalName'
  | 'organization.dba'
  | 'organization.department'
  | 'organization.title'
  | 'organization.role'
  | 'organization.employeeId'
  | 'organization.taxId'
  | 'organization.industry'
  | 'organization.size'
  | 'organization.website'
  | 'organization.phone'
  | 'organization.email'
  | 'webPresence.websiteUrl'
  | 'webPresence.profileUrl'
  | 'webPresence.blogUrl'
  | 'webPresence.avatarUrl'
  | 'webPresence.rssUrl'
  | 'webPresence.social.twitter'
  | 'webPresence.social.x'
  | 'webPresence.social.linkedin'
  | 'webPresence.social.github'
  | 'webPresence.social.facebook'
  | 'webPresence.social.instagram'
  | 'webPresence.social.youtube'
  | 'webPresence.social.tiktok'
  | 'webPresence.social.mastodon'
  | 'webPresence.social.medium'
  | 'webPresence.social.pinterest'
  | 'webPresence.social.discord'
  | 'webPresence.social.telegram'
  | 'webPresence.social.whatsapp'
  | 'seo.metaTitle'
  | 'seo.metaDescription'
  | 'seo.keywords'
  | 'seo.canonicalUrl'
  | 'seo.ogTitle'
  | 'seo.ogDescription'
  | 'seo.ogImage'
  | 'seo.robots'
  | 'businessListing.businessName'
  | 'businessListing.category'
  | 'businessListing.subcategories'
  | 'businessListing.description'
  | 'businessListing.yearEstablished'
  | 'businessListing.licenseNumber'
  | 'businessListing.priceRange'
  | 'businessListing.services'
  | 'businessListing.paymentMethods'
  | 'businessListing.serviceArea'
  | 'businessListing.photos'
  | 'businessListing.logoUrl'
  | 'businessListing.address'
  | 'businessListing.phone'
  | 'businessListing.email'
  | 'businessListing.website'
  | 'message.subject'
  | 'message.body'
  | 'message.attachments'
  | 'message.inquiryType'
  | 'message.preferredDateTime'
  | 'credentials.username'
  | 'credentials.password'
  | 'credentials.otp'
  | 'credentials.oauthProvider'
  | 'credentials.apiKey'
  | 'credentials.token'
  | 'custom.fields'
  | 'tags'
  | 'notes';

export function pickSchema(paths: CanonicalPath[]) {
  // Build a dynamic schema with only requested paths present
  let schema = z.object({});
  const add = (p: CanonicalPath) => {
    const [head, ...rest] = p.split('.');
    if (!head) return;
    const join = rest.join('.');
    switch (head) {
      case 'identity':
        schema = schema.extend({ identity: IdentitySchema.partial() });
        break;
      case 'contact':
        schema = schema.extend({ contact: ContactSchema.partial() });
        break;
      case 'address':
        schema = schema.extend({ address: AddressSchema.partial() });
        break;
      case 'organization':
        schema = schema.extend({ organization: OrganizationSchema.partial() });
        break;
      case 'webPresence':
        schema = schema.extend({ webPresence: WebPresenceSchema.partial() });
        break;
      case 'seo':
        schema = schema.extend({ seo: SEOSchema.partial() });
        break;
      case 'businessListing':
        schema = schema.extend({ businessListing: BusinessListingSchema.partial() });
        break;
      case 'message':
        schema = schema.extend({ message: MessageSchema.partial() });
        break;
      case 'credentials':
        schema = schema.extend({ credentials: CredentialsSchema.partial() });
        break;
      case 'custom':
        schema = schema.extend({ custom: CustomSchema.partial() });
        break;
      case 'tags':
        schema = schema.extend({ tags: z.array(z.string()) });
        break;
      case 'notes':
        schema = schema.extend({ notes: z.string() });
        break;
    }
    void join; // join is unused but kept for clarity
  };
  paths.forEach(add);
  return schema;
}
