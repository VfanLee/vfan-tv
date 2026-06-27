export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  theme: ThemeMode
  subscriptionUrl: string
  subscriptionUpdatedAt?: number
}
