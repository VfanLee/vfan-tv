import { z } from 'zod'

const blockedHeaderNames = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'range'])
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export const sourceHeadersSchema = z
  .record(z.string(), z.string())
  .default({})
  .superRefine((headers, context) => {
    const seen = new Set<string>()
    for (const [name, value] of Object.entries(headers)) {
      const normalized = name.trim().toLowerCase()
      if (!normalized || !headerNamePattern.test(name.trim()) || blockedHeaderNames.has(normalized)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `不允许设置 Header：${name}` })
      } else if (seen.has(normalized)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `Header 名称重复：${name}` })
      }
      if (/[\r\n]/.test(value)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `Header 值包含非法换行：${name}` })
      }
      if (normalized === 'referer' && value.trim() && !isHttpUrl(value.trim())) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: 'Referer 必须是完整的 HTTP(S) 地址' })
      }
      seen.add(normalized)
    }
  })
  .transform((headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.trim(), value])))

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const vodBackupSchema = z.string().trim().url('请输入完整备用 VOD API 地址')

function validateBackups(value: { url: string; backups: string[] }, context: z.RefinementCtx): void {
  const urls = new Set<string>()
  for (const [index, backupUrl] of value.backups.entries()) {
    if (backupUrl === value.url) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['backups', index], message: '备用地址不能与当前地址相同' })
    }
    if (urls.has(backupUrl)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['backups', index], message: '备用地址不能重复' })
    }
    urls.add(backupUrl)
  }
}

const vodSourceDefinitionShape = {
  name: z.string().trim().min(1, '请输入源名称'),
  url: z.string().trim().url('请输入完整 VOD API 地址'),
  disabled: z.boolean().default(false),
  headers: sourceHeadersSchema.optional().default({}),
  backups: z.array(vodBackupSchema).default([]),
}

export const vodSourceImportItemSchema = z.object(vodSourceDefinitionShape).strict().superRefine(validateBackups)

export const vodSourceInputSchema = z.object(vodSourceDefinitionShape).strict().superRefine(validateBackups)

export const vodSourceSubscriptionItemSchema = z.object(vodSourceDefinitionShape).strict().superRefine(validateBackups)

const iptvSourceDefinitionShape = {
  name: z.string().trim().min(1, '请输入 IPTV 源名称'),
  url: z.string().trim().url('请输入完整 IPTV 源地址'),
  disabled: z.boolean().default(false),
  headers: sourceHeadersSchema.optional().default({}),
}

export const iptvSourceSubscriptionItemSchema = z.object(iptvSourceDefinitionShape).strict()

export const iptvSourceImportItemSchema = z.object(iptvSourceDefinitionShape).strict()

export const iptvSourceInputSchema = z.object(iptvSourceDefinitionShape).strict()

export const sourceSubscriptionSchema = z
  .object({
    vod: z.array(vodSourceSubscriptionItemSchema),
    iptv: z.array(iptvSourceSubscriptionItemSchema),
  })
  .strict()

export const vodSourceImportPayloadSchema = z.union([vodSourceImportItemSchema, z.array(vodSourceImportItemSchema)])

export const iptvSourceImportPayloadSchema = z.union([iptvSourceImportItemSchema, z.array(iptvSourceImportItemSchema)])

export type VodSourceImportItemInput = z.infer<typeof vodSourceImportItemSchema>
export type IptvSourceImportItemInput = z.infer<typeof iptvSourceImportItemSchema>
