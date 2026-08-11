import { and, desc, eq, ne } from 'drizzle-orm'
import { uniqBy } from 'es-toolkit/array'
import type { RecentPlayItem } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import { recentPlaysTable } from '../../infrastructure/database/schema'

type RecentPlayRow = typeof recentPlaysTable.$inferSelect

function toRecentPlayItem(row: RecentPlayRow): RecentPlayItem {
  return {
    ...row,
    poster: row.poster ?? undefined,
    rawJson: row.rawJson ?? undefined,
  }
}

/** 持久化播放进度，并在读取时按规范化标题合并历史重复条目 */
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

  clear(): void {
    this.db.delete(recentPlaysTable).run()
  }
}

function dedupeByTitle(items: RecentPlayItem[]): RecentPlayItem[] {
  return uniqBy(items, (item) => normalizeTitle(item.title))
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}
