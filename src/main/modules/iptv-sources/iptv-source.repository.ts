import { asc, eq } from 'drizzle-orm'
import type { IptvSourceConfig } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import { iptvSourcesTable } from '../../infrastructure/database/schema'

type IptvSourceRow = typeof iptvSourcesTable.$inferSelect

function toIptvSourceConfig(row: IptvSourceRow): IptvSourceConfig {
  return row
}

export class IptvSourceRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): IptvSourceConfig[] {
    return this.db.select().from(iptvSourcesTable).orderBy(asc(iptvSourcesTable.sort)).all().map(toIptvSourceConfig)
  }

  findByUrl(url: string): IptvSourceConfig | undefined {
    const row = this.db.select().from(iptvSourcesTable).where(eq(iptvSourcesTable.url, url)).get()
    return row ? toIptvSourceConfig(row) : undefined
  }

  findById(id: string): IptvSourceConfig | undefined {
    const row = this.db.select().from(iptvSourcesTable).where(eq(iptvSourcesTable.id, id)).get()
    return row ? toIptvSourceConfig(row) : undefined
  }

  upsert(source: IptvSourceConfig): IptvSourceConfig {
    this.db
      .insert(iptvSourcesTable)
      .values(source)
      .onConflictDoUpdate({
        target: iptvSourcesTable.url,
        set: {
          name: source.name,
          headers: source.headers,
          disabled: source.disabled,
          sort: source.sort,
          origin: source.origin,
          updatedAt: source.updatedAt,
        },
      })
      .run()

    return this.findByUrl(source.url) ?? source
  }

  update(source: IptvSourceConfig): IptvSourceConfig {
    this.db
      .update(iptvSourcesTable)
      .set({
        name: source.name,
        url: source.url,
        headers: source.headers,
        disabled: source.disabled,
        updatedAt: source.updatedAt,
      })
      .where(eq(iptvSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  updateFromSubscription(source: IptvSourceConfig): IptvSourceConfig {
    this.db
      .update(iptvSourcesTable)
      .set({
        name: source.name,
        headers: source.headers,
        disabled: source.disabled,
        origin: 'subscription',
        updatedAt: source.updatedAt,
      })
      .where(eq(iptvSourcesTable.id, source.id))
      .run()

    return this.findById(source.id) ?? source
  }

  reorder(sourceIds: string[]): IptvSourceConfig[] {
    const updatedAt = Date.now()

    this.db.transaction((tx) => {
      for (const [sort, id] of sourceIds.entries()) {
        tx.update(iptvSourcesTable).set({ sort, updatedAt }).where(eq(iptvSourcesTable.id, id)).run()
      }
    })

    return this.list()
  }

  delete(id: string): void {
    this.db.delete(iptvSourcesTable).where(eq(iptvSourcesTable.id, id)).run()
  }

  clear(): void {
    this.db.delete(iptvSourcesTable).run()
  }

  clearSubscription(): void {
    this.db.delete(iptvSourcesTable).where(eq(iptvSourcesTable.origin, 'subscription')).run()
  }
}
