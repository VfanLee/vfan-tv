import { asc, eq } from 'drizzle-orm'
import type { VodSourceConfig } from '@shared/types'
import type { AppDatabase } from '../db/client'
import { vodSourcesTable } from '../db/schema'

type VodSourceRow = typeof vodSourcesTable.$inferSelect

function toVodSourceConfig(row: VodSourceRow): VodSourceConfig {
  return {
    ...row,
    remark: row.remark ?? undefined,
  }
}

export class VodSourceRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): VodSourceConfig[] {
    return this.db.select().from(vodSourcesTable).orderBy(asc(vodSourcesTable.sort)).all().map(toVodSourceConfig)
  }

  findByBaseUrl(baseUrl: string): VodSourceConfig | undefined {
    const row = this.db.select().from(vodSourcesTable).where(eq(vodSourcesTable.baseUrl, baseUrl)).get()
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
        target: vodSourcesTable.baseUrl,
        set: {
          name: source.name,
          enabled: source.enabled,
          sort: source.sort,
          headers: source.headers,
          remark: source.remark,
          updatedAt: source.updatedAt,
        },
      })
      .run()

    return this.findByBaseUrl(source.baseUrl) ?? source
  }

  update(source: VodSourceConfig): VodSourceConfig {
    this.db
      .update(vodSourcesTable)
      .set({
        name: source.name,
        baseUrl: source.baseUrl,
        enabled: source.enabled,
        headers: source.headers,
        remark: source.remark,
        updatedAt: source.updatedAt,
      })
      .where(eq(vodSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  delete(id: string): void {
    this.db.delete(vodSourcesTable).where(eq(vodSourcesTable.id, id)).run()
  }
}
