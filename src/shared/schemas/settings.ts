import { z } from 'zod'

export const appSettingsSchema = z.object({
  githubProxyCustomPrefix: z.string().trim().default(''),
  githubProxyRoute: z
    .enum(['direct', 'gh-proxy', 'cloudflare-v4', 'cloudflare-v46', 'fastly-v4', 'custom'])
    .default('gh-proxy'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  subscriptionUrl: z.string().trim().default(''),
  subscriptionUpdatedAt: z.number().int().nonnegative().optional(),
})
