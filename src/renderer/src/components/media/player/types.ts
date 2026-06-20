export interface PlayerErrorLog {
  id: number
  timestamp: number
  source: 'HLS' | 'MediaProvider'
  message: string
  fatal: boolean
}

export type ActionHint =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek-back'; seconds: number }
  | { type: 'seek-forward'; seconds: number }
  | { type: 'volume'; percent: number }

export interface KeyHoldState {
  key: string
  timer: ReturnType<typeof setTimeout> | null
  interval: ReturnType<typeof setInterval> | null
  isLongPress: boolean
}
