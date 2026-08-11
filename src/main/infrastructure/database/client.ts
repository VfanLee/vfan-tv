import Database from 'better-sqlite3'
import { app } from 'electron'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'
import { DB_FILE_NAME } from '@shared/constants'

// 初始化和重建 SQLite 数据库。
export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>
const IPTV_SCHEMA_VERSION = 1

const createSchemaSql = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vod_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    headers TEXT NOT NULL DEFAULT '{}',
    backups TEXT NOT NULL DEFAULT '[]',
    disabled INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    remark TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS iptv_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    headers TEXT NOT NULL DEFAULT '{}',
    disabled INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS iptv_channel_snapshots (
    source_id TEXT PRIMARY KEY NOT NULL,
    playlist TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS iptv_epg_metadata (
    cache_key TEXT PRIMARY KEY NOT NULL,
    source_url TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS iptv_epg_programs (
    cache_key TEXT NOT NULL,
    channel_key TEXT NOT NULL,
    date TEXT NOT NULL,
    programs TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE(cache_key, channel_key, date)
  );

  CREATE TABLE IF NOT EXISTS recent_plays (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    vod_id TEXT NOT NULL,
    title TEXT NOT NULL,
    poster TEXT,
    line_name TEXT NOT NULL,
    episode_name TEXT NOT NULL,
    episode_url TEXT NOT NULL,
    current_time INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT,
    played_at INTEGER NOT NULL,
    UNIQUE(source_id, vod_id, line_name, episode_name)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    vod_id TEXT NOT NULL,
    title TEXT NOT NULL,
    poster TEXT,
    year TEXT,
    area TEXT,
    language TEXT,
    category TEXT,
    remarks TEXT,
    actor TEXT,
    director TEXT,
    description TEXT,
    raw_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(source_id, vod_id)
  );
`

export function createDatabase(): AppDatabase {
  const dbDir = join(app.getPath('userData'), 'database')
  mkdirSync(dbDir, { recursive: true })

  const databasePath = join(dbDir, DB_FILE_NAME)

  const sqlite = new Database(databasePath)
  // 启用 WAL 日志模式。
  sqlite.pragma('journal_mode = WAL')
  const schemaVersion = sqlite.pragma('user_version', { simple: true }) as number
  if (schemaVersion < IPTV_SCHEMA_VERSION) {
    const rebuildIptv = sqlite.transaction(() => {
      sqlite.exec(`
        DROP TABLE IF EXISTS iptv_sources;
        DROP TABLE IF EXISTS iptv_channel_snapshots;
        DROP TABLE IF EXISTS iptv_epg_metadata;
        DROP TABLE IF EXISTS iptv_epg_programs;
      `)
      sqlite.exec(createSchemaSql)
      sqlite.pragma(`user_version = ${IPTV_SCHEMA_VERSION}`)
    })
    rebuildIptv()
  } else {
    sqlite.exec(createSchemaSql)
  }

  return drizzle(sqlite, { schema })
}

export function resetAppDatabase(db: AppDatabase): void {
  // 重建数据库并清空现有数据。
  const reset = db.$client.transaction(() => {
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>

    for (const { name } of tables) {
      db.$client.exec(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`)
    }
    db.$client.exec(createSchemaSql)
    db.$client.pragma(`user_version = ${IPTV_SCHEMA_VERSION}`)
  })
  reset()
}

export function removeDeprecatedDatabaseFiles(): void {
  const dbDir = join(app.getPath('userData'), 'database')
  for (const fileName of ['vfan-tv-v3.sqlite', 'vfan-tv-v3.sqlite-wal', 'vfan-tv-v3.sqlite-shm']) {
    rmSync(join(dbDir, fileName), { force: true })
  }
}
