// Synonym and alias mappings for canonical field paths
// Includes multilingual terms for common fields to improve matching.

export type CanonicalPath = string;

export interface MultilingualSynonyms {
  en?: string[];
  es?: string[];
  fr?: string[];
  de?: string[];
  it?: string[];
  pt?: string[];
  nl?: string[];
  sv?: string[];
  no?: string[];
  da?: string[];
  fi?: string[];
  pl?: string[];
  cs?: string[];
  sk?: string[];
  ru?: string[];
  uk?: string[];
  tr?: string[];
  ar?: string[];
  he?: string[];
  zh?: string[];
  ja?: string[];
  ko?: string[];
  hi?: string[];
  id?: string[];
  ms?: string[];
  vi?: string[];
  th?: string[];
}

export interface SynonymMap {
  // Canonical path -> default aliases (language-agnostic)
  aliases: Record<CanonicalPath, string[]>;
  // Canonical path -> multilingual synonyms
  multilingual: Record<CanonicalPath, MultilingualSynonyms>;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

export const UNIVERSAL_SYNONYMS: SynonymMap = {
  aliases: {
    // Identity
    'identity.firstName': ['first name', 'given name', 'forename', 'fname'],
    'identity.middleName': ['middle name', 'mname'],
    'identity.lastName': ['last name', 'surname', 'family name', 'lname'],
    'identity.fullName': ['full name', 'name', 'your name'],
    'identity.salutation': ['title', 'salutation', 'honorific'],
    'identity.suffix': ['name suffix', 'suffix', 'jr', 'sr', 'iii'],
    'identity.preferredName': ['preferred name', 'nickname'],
    'identity.pronouns': ['pronouns'],
    'identity.gender': ['gender', 'sex'],
    'identity.dateOfBirth': ['date of birth', 'dob', 'birthdate'],
    // Contact
    'contact.email': ['email', 'e-mail', 'mail'],
    'contact.altEmails': ['alternate email', 'secondary email', 'backup email'],
    'contact.phone': ['phone', 'telephone', 'tel', 'mobile', 'cell', 'cellphone', 'phone number', 'contact number'],
    'contact.altPhones': ['alternate phone', 'secondary phone', 'backup phone'],
    'contact.fax': ['fax'],
    'contact.preferredContactMethod': ['preferred contact', 'contact method', 'best contact'],
    // Address
    'address.street1': ['address', 'street', 'street address', 'address line 1', 'addr1'],
    'address.street2': ['address line 2', 'addr2', 'suite', 'apartment', 'apt', 'unit'],
    'address.city': ['city', 'town', 'locality'],
    'address.region': ['state', 'province', 'region', 'county'],
    'address.postalCode': ['postal code', 'postcode', 'zip', 'zip code'],
    'address.country': ['country', 'nation'],
    'address.countryCode': ['country code', 'iso country code'],
    'address.formatted': ['formatted address', 'full address'],
    // Organization
    'organization.name': ['company', 'organization', 'org', 'institution', 'business name', 'employer'],
    'organization.legalName': ['legal name', 'registered name'],
    'organization.dba': ['doing business as', 'd/b/a'],
    'organization.department': ['department', 'dept'],
    'organization.title': ['job title', 'position', 'title'],
    'organization.role': ['role', 'position'],
    'organization.employeeId': ['employee id', 'staff id'],
    'organization.taxId': ['tax id', 'vat', 'ein', 'tin'],
    'organization.industry': ['industry'],
    'organization.size': ['company size', 'employees'],
    'organization.website': ['company website', 'organization website'],
    'organization.phone': ['company phone', 'business phone'],
    'organization.email': ['company email', 'business email'],
    // Web Presence
    'webPresence.websiteUrl': ['website', 'site', 'homepage', 'url'],
    'webPresence.profileUrl': ['profile url', 'profile link'],
    'webPresence.blogUrl': ['blog url', 'blog link'],
    'webPresence.avatarUrl': ['avatar url', 'profile image', 'profile photo'],
    'webPresence.rssUrl': ['rss', 'feed', 'rss url'],
    'webPresence.social.twitter': ['twitter', 'x', 'twitter url', 'x url'],
    'webPresence.social.x': ['x', 'x url', 'twitter'],
    'webPresence.social.linkedin': ['linkedin', 'linkedin url', 'linkedin profile'],
    'webPresence.social.github': ['github', 'git hub'],
    'webPresence.social.facebook': ['facebook', 'fb'],
    'webPresence.social.instagram': ['instagram', 'ig'],
    'webPresence.social.youtube': ['youtube', 'yt'],
    'webPresence.social.tiktok': ['tiktok'],
    'webPresence.social.mastodon': ['mastodon'],
    'webPresence.social.medium': ['medium'],
    'webPresence.social.pinterest': ['pinterest'],
    'webPresence.social.discord': ['discord'],
    'webPresence.social.telegram': ['telegram'],
    'webPresence.social.whatsapp': ['whatsapp'],
    // SEO
    'seo.metaTitle': ['meta title', 'title'],
    'seo.metaDescription': ['meta description', 'description'],
    'seo.keywords': ['keywords'],
    'seo.canonicalUrl': ['canonical', 'canonical url'],
    'seo.ogTitle': ['og title', 'open graph title'],
    'seo.ogDescription': ['og description', 'open graph description'],
    'seo.ogImage': ['og image', 'open graph image'],
    'seo.robots': ['robots', 'robots meta'],
    // Business Listing
    'businessListing.businessName': ['business name', 'company name'],
    'businessListing.category': ['category'],
    'businessListing.subcategories': ['subcategories'],
    'businessListing.description': ['description', 'about'],
    'businessListing.yearEstablished': ['year established', 'founded'],
    'businessListing.licenseNumber': ['license', 'license number'],
    'businessListing.priceRange': ['price range'],
    'businessListing.services': ['services'],
    'businessListing.paymentMethods': ['payment methods'],
    'businessListing.serviceArea': ['service area'],
    'businessListing.photos': ['photos', 'images'],
    'businessListing.logoUrl': ['logo', 'logo url'],
    'businessListing.address': ['business address'],
    'businessListing.phone': ['business phone', 'company phone'],
    'businessListing.email': ['business email', 'company email'],
    'businessListing.website': ['business website', 'company website'],
    // Message
    'message.subject': ['subject'],
    'message.body': ['message', 'body', 'comments', 'your message'],
    'message.attachments': ['attachments', 'files'],
    'message.inquiryType': ['inquiry type', 'reason'],
    'message.preferredDateTime': ['preferred time', 'preferred date'],
    // Credentials
    'credentials.username': ['username', 'user name', 'login'],
    'credentials.password': ['password', 'passcode'],
    'credentials.otp': ['otp', 'one time code', '2fa', 'two factor'],
    'credentials.oauthProvider': ['oauth provider', 'sso provider'],
    'credentials.apiKey': ['api key'],
    'credentials.token': ['token', 'access token'],
    // Custom
    'custom.fields': ['custom', 'other']
  },
  multilingual: {
    // Identity.firstName
    'identity.firstName': {
      es: ['nombre'],
      fr: ['prénom'],
      de: ['vorname'],
      it: ['nome'],
      pt: ['nome'],
      nl: ['voornaam'],
      sv: ['förnamn'],
      no: ['fornavn'],
      da: ['fornavn'],
      fi: ['etunimi'],
      pl: ['imię'],
      cs: ['křestní jméno'],
      sk: ['krstné meno'],
      ru: ['имя'],
      uk: ['імʼя'],
      tr: ['ad'],
      ar: ['الاسم الأول'],
      he: ['שם פרטי'],
      zh: ['名', '名字'],
      ja: ['名', '下の名前'],
      ko: ['이름'],
      hi: ['पहला नाम'],
      id: ['nama depan'],
      ms: ['nama pertama'],
      vi: ['tên'],
      th: ['ชื่อ']
    },
    // Identity.lastName
    'identity.lastName': {
      es: ['apellido'],
      fr: ['nom de famille'],
      de: ['nachname'],
      it: ['cognome'],
      pt: ['sobrenome', 'apelido'],
      nl: ['achternaam'],
      sv: ['efternamn'],
      no: ['etternavn'],
      da: ['efternavn'],
      fi: ['sukunimi'],
      pl: ['nazwisko'],
      cs: ['příjmení'],
      sk: ['priezvisko'],
      ru: ['фамилия'],
      uk: ['прізвище'],
      tr: ['soyadı'],
      ar: ['اسم العائلة'],
      he: ['שם משפחה'],
      zh: ['姓'],
      ja: ['姓'],
      ko: ['성'],
      hi: ['अंतिम नाम'],
      id: ['nama belakang'],
      ms: ['nama keluarga'],
      vi: ['họ'],
      th: ['นามสกุล']
    },
    'contact.email': {
      es: ['correo', 'correo electrónico', 'email'],
      fr: ['email', 'courriel'],
      de: ['e-mail', 'email'],
      it: ['email'],
      pt: ['email', 'e-mail'],
      nl: ['e-mail', 'email'],
      sv: ['e-post', 'email'],
      no: ['e-post', 'email'],
      da: ['e-mail'],
      fi: ['sähköposti'],
      pl: ['email', 'e-mail'],
      cs: ['e-mail'],
      sk: ['e-mail'],
      ru: ['электронная почта', 'email'],
      uk: ['електронна пошта', 'email'],
      tr: ['e-posta', 'email'],
      ar: ['البريد الإلكتروني'],
      he: ['דוא"ל'],
      zh: ['电子邮件'],
      ja: ['メール'],
      ko: ['이메일'],
      hi: ['ईमेल'],
      id: ['email'],
      ms: ['e-mel'],
      vi: ['email'],
      th: ['อีเมล']
    },
    'contact.phone': {
      es: ['teléfono', 'móvil', 'celular'],
      fr: ['téléphone', 'mobile'],
      de: ['telefon', 'handy'],
      it: ['telefono', 'cellulare'],
      pt: ['telefone', 'telemóvel', 'celular'],
      nl: ['telefoon'],
      sv: ['telefon'],
      no: ['telefon'],
      da: ['telefon'],
      fi: ['puhelin'],
      pl: ['telefon'],
      cs: ['telefon'],
      sk: ['telefón'],
      ru: ['телефон'],
      uk: ['телефон'],
      tr: ['telefon'],
      ar: ['الهاتف'],
      he: ['טלפון'],
      zh: ['电话'],
      ja: ['電話'],
      ko: ['전화'],
      hi: ['फ़ोन'],
      id: ['telepon'],
      ms: ['telefon'],
      vi: ['điện thoại'],
      th: ['โทรศัพท์']
    },
    'address.street1': {
      es: ['dirección', 'calle', 'dirección línea 1'],
      fr: ['adresse', 'rue', 'adresse ligne 1'],
      de: ['adresse', 'straße', 'anschrift'],
      it: ['indirizzo', 'via'],
      pt: ['endereço', 'rua'],
      nl: ['adres', 'straat'],
      sv: ['adress', 'gata'],
      no: ['adresse', 'gate'],
      da: ['adresse', 'gade'],
      fi: ['osoite', 'katu'],
      pl: ['adres', 'ulica'],
      cs: ['adresa', 'ulice'],
      sk: ['adresa', 'ulica'],
      ru: ['адрес', 'улица'],
      uk: ['адреса', 'вулиця'],
      tr: ['adres', 'sokak'],
      ar: ['العنوان', 'شارع'],
      he: ['כתובת', 'רחוב'],
      zh: ['地址', '街道'],
      ja: ['住所', '丁目'],
      ko: ['주소', '거리']
    },
    'address.postalCode': {
      es: ['código postal'],
      fr: ['code postal'],
      de: ['postleitzahl', 'plz'],
      it: ['cap'],
      pt: ['código postal'],
      nl: ['postcode'],
      sv: ['postnummer'],
      no: ['postnummer'],
      da: ['postnummer'],
      fi: ['postinumero'],
      pl: ['kod pocztowy'],
      cs: ['psč'],
      sk: ['psč'],
      ru: ['почтовый индекс'],
      uk: ['поштовий індекс'],
      tr: ['posta kodu'],
      ar: ['الرمز البريدي'],
      he: ['מיקוד'],
      zh: ['邮政编码'],
      ja: ['郵便番号'],
      ko: ['우편 번호']
    }
  }
};

export function buildAliasIndex(map: SynonymMap, locale?: keyof MultilingualSynonyms): Map<string, CanonicalPath> {
  const index = new Map<string, CanonicalPath>();
  const push = (k: CanonicalPath, v: string[]) => {
    for (const s of v) index.set(normalizeKey(s), k);
  };
  for (const [k, arr] of Object.entries(map.aliases)) push(k, arr);
  if (locale) {
    for (const [k, m] of Object.entries(map.multilingual)) {
      const vals = (m as Record<string, string[]>)[locale as string] || [];
      push(k, vals);
    }
  } else {
    for (const [k, m] of Object.entries(map.multilingual)) {
      const vals = uniq(Object.values(m).flat());
      push(k, vals);
    }
  }
  return index;
}

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCanonical(pathOrAlias: string, locale?: keyof MultilingualSynonyms): CanonicalPath | null {
  const key = normalizeKey(pathOrAlias);
  // exact canonical
  if (UNIVERSAL_SYNONYMS.aliases[pathOrAlias as CanonicalPath]) return pathOrAlias as CanonicalPath;
  const index = buildAliasIndex(UNIVERSAL_SYNONYMS, locale);
  return index.get(key) || null;
}

export function mergeAliasOverlay(base: SynonymMap, overlay: Partial<SynonymMap['aliases']>): SynonymMap {
  const mergedAliases: Record<CanonicalPath, string[]> = { ...base.aliases };
  for (const [k, arr] of Object.entries(overlay)) {
    const existing = mergedAliases[k as CanonicalPath] || [];
    mergedAliases[k as CanonicalPath] = uniq([...existing, ...arr!]);
  }
  return { aliases: mergedAliases, multilingual: { ...base.multilingual } };
}
