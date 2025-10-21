import { z } from "../vendor/mini-zod.js";

export const EncryptedPayloadSchema = z.object({
  v: z.literal(1),
  alg: z.literal('AES-GCM'),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    salt: z.string(), // base64
    iterations: z.number(),
    hash: z.literal('SHA-256')
  }),
  iv: z.string(), // base64
  ciphertext: z.string(), // base64
  createdAt: z.string()
});

export const SettingsSchema = z.object({
  v: z.literal(1),
  passphraseSet: z.boolean(),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    salt: z.string(), // base64
    iterations: z.number(),
    hash: z.literal('SHA-256')
  }),
  verification: z.object({
    iv: z.string(),
    ciphertext: z.string()
  })
});

export const IndexSchema = z.object({
  keys: z.array(z.string())
});
