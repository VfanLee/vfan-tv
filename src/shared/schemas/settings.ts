import { z } from 'zod'

const networkProxyHostSchema = z
  .string()
  .trim()
  .min(1, '代理主机不能为空')
  .refine((value) => !value.includes('://'), '代理主机不能包含协议')
  .refine((value) => !/[\s/@?#]/.test(value), '代理主机不能包含路径、认证信息或空格')

export const networkProxyProfileSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1, '代理名称不能为空'),
    protocol: z.enum(['http', 'https', 'socks5']),
    host: networkProxyHostSchema,
    port: z.number().int().min(1, '代理端口必须大于 0').max(65_535, '代理端口不能超过 65535'),
  })
  .strict()

export const networkRouteSettingsSchema = z
  .object({
    mode: z.enum(['direct', 'system', 'custom']).default('direct'),
    activeProfileId: z.string().trim().min(1).optional(),
  })
  .strict()

export const networkSettingsSchema = z
  .object({
    profiles: z.array(networkProxyProfileSchema).default([]),
    iptv: networkRouteSettingsSchema.default({ mode: 'direct' }),
    epg: networkRouteSettingsSchema.default({ mode: 'direct' }),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const names = new Set<string>()
    for (const [index, profile] of value.profiles.entries()) {
      if (ids.has(profile.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['profiles', index, 'id'], message: '代理 ID 不能重复' })
      }
      ids.add(profile.id)
      const normalizedName = profile.name.toLocaleLowerCase()
      if (names.has(normalizedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', index, 'name'],
          message: '代理名称不能重复',
        })
      }
      names.add(normalizedName)
    }
    for (const route of ['iptv', 'epg'] as const) {
      const routeSettings = value[route]
      if (
        routeSettings.mode === 'custom' &&
        !value.profiles.some((profile) => profile.id === routeSettings.activeProfileId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [route, 'activeProfileId'],
          message: '请选择有效的代理配置',
        })
      }
    }
  })

export const iptvEpgSettingsSchema = z.object({
  mode: z.enum(['source', 'query', 'xmltv']).default('source'),
  url: z.string().trim().url('EPG 地址无效').optional(),
  lastSuccessAt: z.number().int().nonnegative().optional(),
  lastSuccessSource: z.string().optional(),
})

export const appSettingsSchema = z.object({
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
  iptvEpg: iptvEpgSettingsSchema.default({ mode: 'source' }),
  network: networkSettingsSchema.default({
    profiles: [],
    iptv: { mode: 'direct' },
    epg: { mode: 'direct' },
  }),
})
