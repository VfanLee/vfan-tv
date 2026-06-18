import { z } from 'zod'

export const appSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
})
