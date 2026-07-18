import type { LiveSourceConfig, VodSourceConfig } from '@shared/types'

export type SourceDialogState = { mode: 'create' } | { mode: 'edit'; source: VodSourceConfig }

export type LiveSourceDialogState = { mode: 'create' } | { mode: 'edit'; source: LiveSourceConfig }

export interface GitHubProxySpeedState {
  elapsedMs?: number
  errorMessage?: string
  status: 'idle' | 'testing' | 'success' | 'error'
}

export type VodSourceSpeedState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; elapsedMs: number }
  | { status: 'error'; errorMessage: string }

export type ConfirmState =
  | { type: 'clearSources' }
  | { type: 'clearLiveSources' }
  | { type: 'initializeAppData' }
  | { type: 'importAppData' }
  | { type: 'deleteSource'; source: VodSourceConfig }
  | { type: 'deleteLiveSource'; source: LiveSourceConfig }
