import { z } from 'zod';

export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
});

export type Settings = z.infer<typeof SettingsSchema>;
