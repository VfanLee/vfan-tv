import { asc, eq } from 'drizzle-orm'
import type { LiveSourceConfig } from '@shared/types'
import type { AppDatabase } from '../db/client'
import { liveSourcesTable } from '../db/schema'

type LiveSourceRow = typeof liveSourcesTable.$inferSelect

function toLiveSourceConfig(row: LiveSourceRow): LiveSourceConfig {
  return row
}

export class LiveSourceRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): LiveSourceConfig[] {
    return this.db.select().from(liveSourcesTable).orderBy(asc(liveSourcesTable.sort)).all().map(toLiveSourceConfig)
  }

  findByUrl(url: string): LiveSourceConfig | undefined {
    const row = this.db.select().from(liveSourcesTable).where(eq(liveSourcesTable.url, url)).get()
    return row ? toLiveSourceConfig(row) : undefined
  }

  findById(id: string): LiveSourceConfig | undefined {
    const row = this.db.select().from(liveSourcesTable).where(eq(liveSourcesTable.id, id)).get()
    return row ? toLiveSourceConfig(row) : undefined
  }

  upsert(source: LiveSourceConfig): LiveSourceConfig {
    this.db
      .insert(liveSourcesTable)
      .values(source)
      .onConflictDoUpdate({
        target: liveSourcesTable.url,
        set: {
          name: source.name,
          enabled: source.enabled,
          sort: source.sort,
          origin: source.origin,
          updatedAt: source.updatedAt,
        },
      })
      .run()

    return this.findByUrl(source.url) ?? source
  }

  update(source: LiveSourceConfig): LiveSourceConfig {
    this.db
      .update(liveSourcesTable)
      .set({
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        updatedAt: source.updatedAt,
      })
      .where(eq(liveSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  updateFromSubscription(source: LiveSourceConfig): LiveSourceConfig {
    this.db
      .update(liveSourcesTable)
      .set({
        name: source.name,
        enabled: source.enabled,
        origin: 'subscription',
        updatedAt: source.updatedAt,
      })
      .where(eq(liveSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  reorder(sourceIds: string[]): LiveSourceConfig[] {
    const updatedAt = Date.now()

    this.db.transaction((tx) => {
      for (const [sort, id] of sourceIds.entries()) {
        tx.update(liveSourcesTable).set({ sort, updatedAt }).where(eq(liveSourcesTable.id, id)).run()
      }
    })

    return this.list()
  }

  delete(id: string): void {
    this.db.delete(liveSourcesTable).where(eq(liveSourcesTable.id, id)).run()
  }

  clear(): void {
    this.db.delete(liveSourcesTable).run()
  }
}
