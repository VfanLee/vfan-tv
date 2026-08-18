import { eq } from 'drizzle-orm'
import type { IptvPlaylist } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import { iptvChannelSnapshotsTable } from '../../infrastructure/database/schema'

/** 持久化 IPTV 频道快照 */
export class IptvCacheRepository {
  constructor(private readonly db: AppDatabase) {}

  getPlaylist(sourceId: string): IptvPlaylist | undefined {
    const row = this.db
      .select()
      .from(iptvChannelSnapshotsTable)
      .where(eq(iptvChannelSnapshotsTable.sourceId, sourceId))
      .get()
    return row?.playlist
  }

  savePlaylist(sourceId: string, playlist: IptvPlaylist): void {
    const now = Date.now()
    this.db
      .insert(iptvChannelSnapshotsTable)
      .values({ sourceId, playlist, fetchedAt: playlist.fetchedAt, updatedAt: now })
      .onConflictDoUpdate({
        target: iptvChannelSnapshotsTable.sourceId,
        set: { playlist, fetchedAt: playlist.fetchedAt, updatedAt: now },
      })
      .run()
  }

  deletePlaylist(sourceId: string): void {
    this.db.delete(iptvChannelSnapshotsTable).where(eq(iptvChannelSnapshotsTable.sourceId, sourceId)).run()
  }

  clearAll(): void {
    this.db.delete(iptvChannelSnapshotsTable).run()
  }
}
