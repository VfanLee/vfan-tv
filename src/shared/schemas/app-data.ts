import { z } from 'zod'
import { sourceHeadersSchema } from './source'
import { iptvEpgSettingsSchema } from './settings'

const optionalStringSchema = z.string().optional()
function validateVodSourceBackups(value: { url: string; backups: string[] }, context: z.RefinementCtx): void {
  const urls = new Set<string>()
  for (const [index, backupUrl] of value.backups.entries()) {
    if (backupUrl === value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index],
        message: 'VOD 备用地址不能与当前地址相同',
      })
    }
    if (urls.has(backupUrl)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backups', index],
        message: 'VOD 备用地址不能重复',
      })
    }
    urls.add(backupUrl)
  }
}

export const appDataSelectionSchema = z
  .object({
    favorites: z.boolean(),
    recent: z.boolean(),
    searchHistory: z.boolean(),
    sources: z.boolean(),
  })
  .strict()

export const appDataClearSelectionSchema = z
  .object({
    cache: z.boolean(),
    favorites: z.boolean(),
    recent: z.boolean(),
    searchHistory: z.boolean(),
    sources: z.boolean(),
  })
  .strict()
  .refine((selection) => Object.values(selection).some(Boolean), '请至少选择一项要清除的数据')

export const appDataClientPayloadSchema = z
  .object({
    selection: appDataSelectionSchema,
    searchHistory: z.array(z.string()),
  })
  .strict()

export const appDataVodSourceSchema = z
  .object({
    name: z.string().trim().min(1, 'VOD 源名称不能为空'),
    url: z.string().trim().url('VOD 源 URL 无效'),
    disabled: z.boolean().default(false),
    headers: sourceHeadersSchema.optional().default({}),
    backups: z.array(z.string().trim().url('VOD 备用地址 URL 无效')).default([]),
    origin: z.enum(['manual', 'subscription']).default('manual'),
    sort: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine(validateVodSourceBackups)

export const appDataIptvSourceSchema = z
  .object({
    name: z.string().trim().min(1, 'IPTV 源名称不能为空'),
    url: z.string().trim().url('IPTV 源 URL 无效'),
    disabled: z.boolean().default(false),
    origin: z.enum(['manual', 'subscription']).default('manual'),
    sort: z.number().int().nonnegative().optional(),
    headers: sourceHeadersSchema.optional().default({}),
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

const appDataBackupBaseSchema = z
  .object({
    app: z.literal('vfan-tv'),
    schemaVersion: z.literal(3),
    exportedAt: z.number().int().nonnegative(),
    subscriptions: z.array(z.object({ id: z.string().min(1), url: z.string().url() })),
    activeSubscriptionId: z.string().optional(),
    iptvEpg: iptvEpgSettingsSchema.optional(),
    vod: z.array(appDataVodSourceSchema),
    iptv: z.array(appDataIptvSourceSchema),
    recent: z.array(appDataRecentPlaySchema),
    favorites: z.array(appDataFavoriteSchema),
    searchHistory: z.array(z.string()),
  })
  .strict()

export const appDataBackupSchema = appDataBackupBaseSchema

export type AppDataBackupInput = z.infer<typeof appDataBackupSchema>
