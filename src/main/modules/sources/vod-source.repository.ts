import { asc, eq } from 'drizzle-orm'
import type { VodSourceConfig } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import { vodSourcesTable } from '../../infrastructure/database/schema'

type VodSourceRow = typeof vodSourcesTable.$inferSelect

function toVodSourceConfig(row: VodSourceRow): VodSourceConfig {
  return {
    ...row,
    referer: row.referer ?? undefined,
    remark: row.remark ?? undefined,
  }
}

export class VodSourceRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): VodSourceConfig[] {
    return this.db.select().from(vodSourcesTable).orderBy(asc(vodSourcesTable.sort)).all().map(toVodSourceConfig)
  }

  findByUrl(url: string): VodSourceConfig | undefined {
    const row = this.db.select().from(vodSourcesTable).where(eq(vodSourcesTable.url, url)).get()
    return row ? toVodSourceConfig(row) : undefined
  }

  findById(id: string): VodSourceConfig | undefined {
    const row = this.db.select().from(vodSourcesTable).where(eq(vodSourcesTable.id, id)).get()
    return row ? toVodSourceConfig(row) : undefined
  }

  upsert(source: VodSourceConfig): VodSourceConfig {
    this.db
      .insert(vodSourcesTable)
      .values(source)
      .onConflictDoUpdate({
        target: vodSourcesTable.url,
        set: {
          name: source.name,
          referer: source.referer,
          enabled: source.enabled,
          sort: source.sort,
          origin: source.origin,
          remark: source.remark,
          updatedAt: source.updatedAt,
        },
      })
      .run()

    return this.findByUrl(source.url) ?? source
  }

  update(source: VodSourceConfig): VodSourceConfig {
    this.db
      .update(vodSourcesTable)
      .set({
        name: source.name,
        url: source.url,
        referer: source.referer,
        enabled: source.enabled,
        remark: source.remark,
        updatedAt: source.updatedAt,
      })
      .where(eq(vodSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  updateFromSubscription(source: VodSourceConfig): VodSourceConfig {
    this.db
      .update(vodSourcesTable)
      .set({
        name: source.name,
        referer: source.referer,
        enabled: source.enabled,
        origin: 'subscription',
        updatedAt: source.updatedAt,
      })
      .where(eq(vodSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  reorder(sourceIds: string[]): VodSourceConfig[] {
    const updatedAt = Date.now()

    this.db.transaction((tx) => {
      for (const [sort, id] of sourceIds.entries()) {
        tx.update(vodSourcesTable).set({ sort, updatedAt }).where(eq(vodSourcesTable.id, id)).run()
      }
    })

    return this.list()
  }

  delete(id: string): void {
    this.db.delete(vodSourcesTable).where(eq(vodSourcesTable.id, id)).run()
  }

  clear(): void {
    this.db.delete(vodSourcesTable).run()
  }
}
