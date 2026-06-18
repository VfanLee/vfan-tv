import { eq } from 'drizzle-orm'
import { appSettingsSchema } from '@shared/schemas'
import type { AppSettings } from '@shared/types'
import type { AppDatabase } from '../db/client'
import { settingsTable } from '../db/schema'

const settingsKey = 'app'

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(): AppSettings {
    const row = this.db.select().from(settingsTable).where(eq(settingsTable.key, settingsKey)).get()
    return appSettingsSchema.parse(row?.value ?? {})
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
