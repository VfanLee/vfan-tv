import { eq } from 'drizzle-orm'
import { appSettingsSchema } from '@shared/schemas'
import type { AppSettings } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import { settingsTable } from '../../infrastructure/database/schema'

const settingsKey = 'app'

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(): AppSettings {
    const row = this.db.select().from(settingsTable).where(eq(settingsTable.key, settingsKey)).get()
    const raw = (row?.value ?? {}) as Record<string, unknown>
    const legacyUrl = typeof raw.subscriptionUrl === 'string' ? raw.subscriptionUrl.trim() : ''
    const subscriptions = raw.subscriptions ?? (legacyUrl ? [{ id: 'legacy-subscription', url: legacyUrl }] : [])
    const activeSubscriptionId =
      typeof raw.activeSubscriptionId === 'string'
        ? raw.activeSubscriptionId
        : legacyUrl
          ? 'legacy-subscription'
          : undefined
    const parsed = appSettingsSchema.parse({
      ...raw,
      subscriptions,
      activeSubscriptionId,
    })
    return {
      ...parsed,
      activeSubscriptionId: parsed.subscriptions.some((item) => item.id === parsed.activeSubscriptionId)
        ? parsed.activeSubscriptionId
        : parsed.subscriptions[0]?.id,
    }
  }

  update(input: Partial<AppSettings>): AppSettings {
    const nextSettings = appSettingsSchema.parse({
      ...this.get(),
      ...input,
    })

    this.db
      .insert(settingsTable)
      .values({
        key: settingsKey,
        value: nextSettings,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          value: nextSettings,
          updatedAt: Date.now(),
        },
      })
      .run()

    return nextSettings
  }
}
