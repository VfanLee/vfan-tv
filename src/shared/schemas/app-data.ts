import { z } from 'zod'

const optionalStringSchema = z.string().optional()
const vodSourceBackupSchema = z.object({
  url: z.string().trim().url('VOD 备用地址 URL 无效'),
  referer: z
    .string()
    .trim()
    .url('VOD 备用地址 Referer 无效')
    .optional()
    .or(z.literal(''))
    .transform((value) => value || undefined),
})

function validateVodSourceBackups(
  value: { url: string; backups: Array<{ url: string }> },
  context: z.RefinementCtx,
): void {
  const urls = new Set<string>()
  for (const [index, backup] of value.backups.entries()) {
    if (backup.url === value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index, 'url'],
        message: 'VOD 备用地址不能与当前地址相同',
      })
    }
    if (urls.has(backup.url)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index, 'url'],
        message: 'VOD 备用地址不能重复',
      })
    }
    urls.add(backup.url)
  }
}

export const appDataClientPayloadSchema = z
  .object({
    searchHistory: z.array(z.string()),
  })
  .strict()

export const appDataVodSourceSchema = z
  .object({
    name: z.string().trim().min(1, 'VOD 源名称不能为空'),
    url: z.string().trim().url('VOD 源 URL 无效'),
    referer: z
      .string()
      .trim()
      .url('VOD 源 Referer 无效')
      .optional()
      .or(z.literal(''))
      .transform((value) => value || undefined),
    enabled: z.boolean(),
    backups: z.array(vodSourceBackupSchema).default([]),
    origin: z.enum(['manual', 'subscription']).default('manual'),
    sort: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine(validateVodSourceBackups)

export const appDataLiveSourceSchema = z
  .object({
    name: z.string().trim().min(1, '直播源名称不能为空'),
    url: z.string().trim().url('直播源 URL 无效'),
    enabled: z.boolean(),
    origin: z.enum(['manual', 'subscription']).default('manual'),
    sort: z.number().int().nonnegative().optional(),
  })
  .strict()

export const appDataRecentPlaySchema = z
  .object({
    id: z.string().trim().min(1),
    sourceId: z.string(),
    sourceName: z.string(),
    vodId: z.string(),
    title: z.string(),
    poster: optionalStringSchema,
    lineName: z.string(),
    episodeName: z.string(),
    episodeUrl: z.string(),
    currentTime: z.number().nonnegative(),
    duration: z.number().nonnegative(),
    rawJson: optionalStringSchema,
    playedAt: z.number().int().nonnegative(),
  })
  .strict()

export const appDataFavoriteSchema = z
  .object({
    id: z.string().trim().min(1),
    sourceId: z.string(),
    sourceName: z.string(),
    sourceUrl: optionalStringSchema,
    vodId: z.string(),
    title: z.string(),
    poster: optionalStringSchema,
    year: optionalStringSchema,
    area: optionalStringSchema,
    language: optionalStringSchema,
    category: optionalStringSchema,
    remarks: optionalStringSchema,
    actor: optionalStringSchema,
    director: optionalStringSchema,
    description: optionalStringSchema,
    rawJson: optionalStringSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()

export const appDataBackupSchema = z
  .object({
    app: z.literal('vfan-tv'),
    schemaVersion: z.literal(1),
    exportedAt: z.number().int().nonnegative(),
    subscription: z
      .object({
        url: z.string(),
        updatedAt: z.number().int().nonnegative().optional(),
      })
      .strict(),
    vod: z.array(appDataVodSourceSchema),
    live: z.array(appDataLiveSourceSchema),
    recent: z.array(appDataRecentPlaySchema),
    favorites: z.array(appDataFavoriteSchema),
    searchHistory: z.array(z.string()),
  })
  .strict()

export type AppDataBackupInput = z.infer<typeof appDataBackupSchema>
