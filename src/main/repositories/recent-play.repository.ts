import { and, desc, eq, ne } from 'drizzle-orm'
import type { RecentPlayItem } from '@shared/types'
import type { AppDatabase } from '../db/client'
import { recentPlaysTable } from '../db/schema'

type RecentPlayRow = typeof recentPlaysTable.$inferSelect

function toRecentPlayItem(row: RecentPlayRow): RecentPlayItem {
  return {
    ...row,
    poster: row.poster ?? undefined,
    rawJson: row.rawJson ?? undefined,
  }
}

export class RecentPlayRepository {
  constructor(private readonly db: AppDatabase) {}

  list(limit = 20): RecentPlayItem[] {
    const rows = this.db
      .select()
      .from(recentPlaysTable)
      .orderBy(desc(recentPlaysTable.playedAt))
      .all()
      .map(toRecentPlayItem)

    return dedupeByTitle(rows).slice(0, limit)
  }

  upsert(item: RecentPlayItem): RecentPlayItem {
    this.db
      .delete(recentPlaysTable)
      .where(and(eq(recentPlaysTable.title, item.title), ne(recentPlaysTable.id, item.id)))
      .run()

    this.db
      .insert(recentPlaysTable)
      .values(item)
      .onConflictDoUpdate({
        target: recentPlaysTable.id,
        set: {
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          vodId: item.vodId,
          title: item.title,
          poster: item.poster,
          lineName: item.lineName,
          episodeName: item.episodeName,
          episodeUrl: item.episodeUrl,
          currentTime: item.currentTime,
          duration: item.duration,
          rawJson: item.rawJson,
          playedAt: item.playedAt,
        },
      })
      .run()

    return item
  }

  deleteByTitle(title: string): void {
    this.db.delete(recentPlaysTable).where(eq(recentPlaysTable.title, title)).run()
  }
}

function dedupeByTitle(items: RecentPlayItem[]): RecentPlayItem[] {
  const map = new Map<string, RecentPlayItem>()

  for (const item of items) {
    const key = normalizeTitle(item.title)

    if (!map.has(key)) {
      map.set(key, item)
    }
  }

  return Array.from(map.values())
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}
