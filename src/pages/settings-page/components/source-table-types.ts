import { type LucideIcon } from 'lucide-react'
import type { IptvSourceConfig, VodSourceConfig } from '@/types'
import type { VodSourceSpeedState } from '../types'

export type SourceConfig = VodSourceConfig | IptvSourceConfig

export type SpeedSortOrder = 'asc' | 'desc' | 'default'

export interface SourceTableCardProps<T extends SourceConfig> {
  addText: string
  allSelected: boolean
  apiAvailable: boolean
  emptyIcon: LucideIcon
  emptyText: string
  enabledCount: number
  heightClassName: string
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  isTestingAll?: boolean
  selectedSourceIds: Set<string>
  sources: T[]
  speedResults?: Record<string, VodSourceSpeedState>
  tableLabel: string
  onAdd: () => void
  onBatchSetDisabled: (disabled: boolean) => void
  onClear: () => void
  onDelete: (source: T) => void
  onEdit: (source: T) => void
  onExport: () => void
  onImport: () => void
  onMoveToEdge: (sourceId: string, edge: 'start' | 'end') => void
  onTestAll?: () => void
  onTestSingle?: (sourceId: string) => void
  onSetDisabled: (source: T, disabled: boolean) => void
  onSwitchBackup?: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}
