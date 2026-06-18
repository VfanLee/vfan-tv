import { z } from 'zod'

export const vodSourceImportItemSchema = z.object({
  name: z.string().trim().min(1, '请输入源名称'),
  baseUrl: z.string().trim().url('请输入完整 VOD API 地址'),
  enabled: z.boolean().default(false),
  headers: z.record(z.string(), z.string()).default({}),
})

export const vodSourceInputSchema = z.object({
  name: z.string().trim().min(1, '请输入播放源名称'),
  baseUrl: z.string().trim().url('请输入完整源路径'),
  enabled: z.boolean().default(false),
})

export const vodSourceImportPayloadSchema = z.union([vodSourceImportItemSchema, z.array(vodSourceImportItemSchema)])

export type VodSourceImportItemInput = z.infer<typeof vodSourceImportItemSchema>
