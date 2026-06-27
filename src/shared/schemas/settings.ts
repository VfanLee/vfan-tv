import { z } from 'zod'

export const appSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  subscriptionUrl: z.string().trim().default(''),
  subscriptionUpdatedAt: z.number().int().nonnegative().optional(),
})
