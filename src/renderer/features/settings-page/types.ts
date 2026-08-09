import type { IptvSourceConfig, SubscriptionConfig, VodSourceConfig } from '@shared/types'

export type SourceDialogState = { mode: 'create' } | { mode: 'edit'; source: VodSourceConfig }

export type IptvSourceDialogState = { mode: 'create' } | { mode: 'edit'; source: IptvSourceConfig }

export type VodSourceSpeedState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; elapsedMs: number }
  | { status: 'error'; errorMessage: string }

export type ConfirmState =
  | { type: 'clearSources' }
  | { type: 'clearIptvSources' }
  | { type: 'restoreFactorySettings' }
  | { type: 'importAppData' }
  | { type: 'deleteSource'; source: VodSourceConfig }
  | { type: 'deleteIptvSource'; source: IptvSourceConfig }
  | { type: 'deleteSubscription'; subscription: SubscriptionConfig }
  | { type: 'selectSubscription'; subscriptionId: string }
