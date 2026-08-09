import { and, eq, gt } from 'drizzle-orm'
import type { IptvEpgProgram, IptvPlaylist } from '@shared/types'
import type { AppDatabase } from '../../infrastructure/database/client'
import {
  iptvChannelSnapshotsTable,
  iptvEpgMetadataTable,
  iptvEpgProgramsTable,
} from '../../infrastructure/database/schema'

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

  getPrograms(cacheKey: string, channelKey: string, date: string): IptvEpgProgram[] | undefined {
    return this.db
      .select({ programs: iptvEpgProgramsTable.programs })
      .from(iptvEpgProgramsTable)
      .where(
        and(
          eq(iptvEpgProgramsTable.cacheKey, cacheKey),
          eq(iptvEpgProgramsTable.channelKey, channelKey),
          eq(iptvEpgProgramsTable.date, date),
          gt(iptvEpgProgramsTable.expiresAt, Date.now()),
        ),
      )
      .get()?.programs
  }

  savePrograms(
    cacheKey: string,
    channelKey: string,
    date: string,
    programs: IptvEpgProgram[],
    expiresAt: number,
  ): void {
    const fetchedAt = Date.now()
    this.db
      .insert(iptvEpgProgramsTable)
      .values({ cacheKey, channelKey, date, programs, fetchedAt, expiresAt })
      .onConflictDoUpdate({
        target: [iptvEpgProgramsTable.cacheKey, iptvEpgProgramsTable.channelKey, iptvEpgProgramsTable.date],
        set: { programs, fetchedAt, expiresAt },
      })
      .run()
  }

  isProviderFresh(cacheKey: string): boolean {
    return Boolean(
      this.db
        .select({ cacheKey: iptvEpgMetadataTable.cacheKey })
        .from(iptvEpgMetadataTable)
        .where(and(eq(iptvEpgMetadataTable.cacheKey, cacheKey), gt(iptvEpgMetadataTable.expiresAt, Date.now())))
        .get(),
    )
  }

  saveProviderMetadata(
    cacheKey: string,
    sourceUrl: string,
    providerType: string,
    expiresAt: number,
    errorMessage?: string,
  ): void {
    const fetchedAt = Date.now()
    this.db
      .insert(iptvEpgMetadataTable)
      .values({ cacheKey, sourceUrl, providerType, fetchedAt, expiresAt, errorMessage })
      .onConflictDoUpdate({
        target: iptvEpgMetadataTable.cacheKey,
        set: { sourceUrl, providerType, fetchedAt, expiresAt, errorMessage },
      })
      .run()
  }

  clearEpg(): void {
    this.db.transaction((tx) => {
      tx.delete(iptvEpgProgramsTable).run()
      tx.delete(iptvEpgMetadataTable).run()
    })
  }

  clearAll(): void {
    this.db.transaction((tx) => {
      tx.delete(iptvChannelSnapshotsTable).run()
      tx.delete(iptvEpgProgramsTable).run()
      tx.delete(iptvEpgMetadataTable).run()
    })
  }
}
