export interface AppLogInfo {
  directoryPath: string
  filePath: string
  fileSizeBytes: number
  totalSizeBytes: number
  maxFileSizeBytes: number
  maxTotalSizeBytes: number
  updatedAt?: number
}
