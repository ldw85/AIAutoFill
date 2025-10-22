import { z } from 'zod';

export const EncryptedPayloadSchema = z.object({
  v: z.literal(1),
  alg: z.literal('AES-GCM'),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    salt: z.string(),
    iterations: z.number(),
    hash: z.literal('SHA-256')
  }),
  iv: z.string(),
  ciphertext: z.string(),
  createdAt: z.string()
});
export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;

export const SettingsSchema = z.object({
  v: z.literal(1),
  passphraseSet: z.boolean(),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    salt: z.string(),
    iterations: z.number(),
    hash: z.literal('SHA-256')
  }),
  verification: z.object({
    iv: z.string(),
    ciphertext: z.string()
  })
});
export type Settings = z.infer<typeof SettingsSchema>;

export const IndexSchema = z.object({ keys: z.array(z.string()) });
export type Index = z.infer<typeof IndexSchema>;
