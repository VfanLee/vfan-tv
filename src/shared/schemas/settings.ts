import { z } from 'zod'

export const appSettingsSchema = z.object({
  githubProxyCustomPrefix: z.string().trim().default(''),
  githubProxyRoute: z
    .enum(['direct', 'gh-proxy', 'cloudflare-v4', 'cloudflare-v46', 'fastly-v4', 'custom'])
    .default('gh-proxy'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  subscriptions: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        url: z
          .string()
          .trim()
          .url('订阅地址无效')
          .refine((value) => /^https?:\/\//.test(value), '订阅地址仅支持 HTTP 或 HTTPS'),
      }),
    )
    .default([]),
  activeSubscriptionId: z.string().trim().min(1).optional(),
})
