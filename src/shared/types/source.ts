export interface VodSourceImportItem {
  name: string
  baseUrl: string
  enabled?: boolean
  headers?: Record<string, string>
}

export interface VodSourceConfig {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  sort: number
  headers: Record<string, string>
  remark?: string
  createdAt: number
  updatedAt: number
}

export type VodSourceInput = Pick<VodSourceImportItem, 'name' | 'baseUrl' | 'enabled'>

export interface VodSourceImportPreview {
  validItems: VodSourceImportItem[]
  invalidItems: Array<{
    index: number
    reason: string
    raw: unknown
  }>
  newItems: VodSourceImportItem[]
  overwriteItems: VodSourceImportItem[]
  skippedItems: VodSourceImportItem[]
}

export interface VodSourceImportResult {
  created: VodSourceConfig[]
  overwritten: VodSourceConfig[]
  skipped: VodSourceImportItem[]
  invalid: VodSourceImportPreview['invalidItems']
}

export interface VodSourceFileResult extends VodSourceImportResult {
  filePath?: string
  cancelled: boolean
}

export interface VodSourceExportResult {
  filePath?: string
  count: number
  cancelled: boolean
}
