import { z } from 'zod'

const vodSourceEndpointSchema = z.object({
  url: z.string().trim().url('请输入完整 VOD API 地址'),
  referer: z
    .string()
    .trim()
    .url('请输入完整 Referer 地址')
    .optional()
    .or(z.literal(''))
    .transform((value) => value || undefined),
})

function validateBackups(value: { url: string; backups: Array<{ url: string }> }, context: z.RefinementCtx): void {
  const urls = new Set<string>()
  for (const [index, backup] of value.backups.entries()) {
    if (backup.url === value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index, 'url'],
        message: '备用地址不能与当前地址相同',
      })
    }
    if (urls.has(backup.url)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index, 'url'],
        message: '备用地址不能重复',
      })
    }
    urls.add(backup.url)
  }
}

export const vodSourceImportItemSchema = z
  .object({
    name: z.string().trim().min(1, '请输入源名称'),
    url: z.string().trim().url('请输入完整 VOD API 地址'),
    referer: z
      .string()
      .trim()
      .url('请输入完整 Referer 地址')
      .optional()
      .or(z.literal(''))
      .transform((value) => value || undefined),
    enabled: z.boolean().optional(),
    backups: z.array(vodSourceEndpointSchema).default([]),
  })
  .strict()
  .superRefine(validateBackups)

export const vodSourceInputSchema = z
  .object({
    name: z.string().trim().min(1, '请输入数据源名称'),
    url: z.string().trim().url('请输入完整源路径'),
    referer: z
      .string()
      .trim()
      .url('请输入完整 Referer 地址')
      .optional()
      .or(z.literal(''))
      .transform((value) => value || undefined),
    enabled: z.boolean().default(false),
    backups: z.array(vodSourceEndpointSchema).default([]),
  })
  .superRefine(validateBackups)

export const vodSourceSubscriptionItemSchema = z
  .object({
    name: z.string().trim().min(1, '订阅数据源名称不能为空'),
    url: z.string().trim().url('订阅数据源 URL 无效'),
    referer: z
      .string()
      .trim()
      .url('订阅数据源 Referer 无效')
      .optional()
      .or(z.literal(''))
      .transform((value) => value || undefined),
    enabled: z.boolean().optional(),
    backups: z.array(vodSourceEndpointSchema).default([]),
  })
  .strict()
  .superRefine(validateBackups)

export const liveSourceSubscriptionItemSchema = z
  .object({
    name: z.string().trim().min(1, '订阅直播源名称不能为空'),
    url: z.string().trim().url('订阅直播源 URL 无效'),
    enabled: z.boolean().optional(),
  })
  .strict()

export const liveSourceImportItemSchema = z
  .object({
    name: z.string().trim().min(1, '请输入直播源名称'),
    url: z.string().trim().url('请输入完整直播源地址'),
    enabled: z.boolean().optional(),
  })
  .strict()

export const liveSourceInputSchema = z.object({
  name: z.string().trim().min(1, '请输入直播源名称'),
  url: z.string().trim().url('请输入完整直播源地址'),
  enabled: z.boolean().default(true),
})

export const sourceSubscriptionSchema = z
  .object({
    updatedAt: z.number().int().nonnegative().optional(),
    vod: z.array(vodSourceSubscriptionItemSchema),
    live: z.array(liveSourceSubscriptionItemSchema),
  })
  .strict()

export const vodSourceImportPayloadSchema = z.union([vodSourceImportItemSchema, z.array(vodSourceImportItemSchema)])

export const liveSourceImportPayloadSchema = z.union([liveSourceImportItemSchema, z.array(liveSourceImportItemSchema)])

export type VodSourceImportItemInput = z.infer<typeof vodSourceImportItemSchema>
export type LiveSourceImportItemInput = z.infer<typeof liveSourceImportItemSchema>
