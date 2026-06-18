import { and, desc, eq } from 'drizzle-orm'
import type { FavoriteInput, FavoriteItem } from '@shared/types'
import type { AppDatabase } from '../db/client'
import { favoritesTable } from '../db/schema'

type FavoriteRow = typeof favoritesTable.$inferSelect

function toFavoriteItem(row: FavoriteRow): FavoriteItem {
  return {
    ...row,
    sourceBaseUrl: row.sourceBaseUrl ?? undefined,
    sourceHeaders: row.sourceHeaders ?? undefined,
    poster: row.poster ?? undefined,
    year: row.year ?? undefined,
    area: row.area ?? undefined,
    language: row.language ?? undefined,
    category: row.category ?? undefined,
    remarks: row.remarks ?? undefined,
    actor: row.actor ?? undefined,
    director: row.director ?? undefined,
    description: row.description ?? undefined,
    rawJson: row.rawJson ?? undefined,
  }
}

export class FavoriteRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): FavoriteItem[] {
    return this.db.select().from(favoritesTable).orderBy(desc(favoritesTable.updatedAt)).all().map(toFavoriteItem)
  }

  isFavorite(sourceId: string, vodId: string): boolean {
    const row = this.db
      .select({ id: favoritesTable.id })
      .from(favoritesTable)
      .where(and(eq(favoritesTable.sourceId, sourceId), eq(favoritesTable.vodId, vodId)))
      .get()

    return Boolean(row)
  }

  upsert(input: FavoriteInput): FavoriteItem {
    const now = Date.now()
    const item: FavoriteItem = {
      ...input,
      createdAt: now,
      updatedAt: now,
    }

    this.db
      .insert(favoritesTable)
      .values(item)
      .onConflictDoUpdate({
        target: [favoritesTable.sourceId, favoritesTable.vodId],
        set: {
          sourceName: item.sourceName,
          sourceBaseUrl: item.sourceBaseUrl,
          sourceHeaders: item.sourceHeaders,
          title: item.title,
          poster: item.poster,
          year: item.year,
          area: item.area,
          language: item.language,
          category: item.category,
          remarks: item.remarks,
          actor: item.actor,
          director: item.director,
          description: item.description,
          rawJson: item.rawJson,
          updatedAt: now,
        },
      })
      .run()

    return this.get(input.sourceId, input.vodId) ?? item
  }

  delete(sourceId: string, vodId: string): void {
    this.db
      .delete(favoritesTable)
      .where(and(eq(favoritesTable.sourceId, sourceId), eq(favoritesTable.vodId, vodId)))
      .run()
  }

  private get(sourceId: string, vodId: string): FavoriteItem | undefined {
    const row = this.db
      .select()
      .from(favoritesTable)
      .where(and(eq(favoritesTable.sourceId, sourceId), eq(favoritesTable.vodId, vodId)))
      .get()

    return row ? toFavoriteItem(row) : undefined
  }
}
