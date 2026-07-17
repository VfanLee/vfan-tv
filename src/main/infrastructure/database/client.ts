import Database from 'better-sqlite3'
import { app } from 'electron'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'
import { DB_FILE_NAME } from '@shared/constants'

// SQLite 的初始化与重建入口。表结构在运行时创建，因此重置必须复用同一份 SQL。
export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

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
    referer TEXT,
    enabled INTEGER NOT NULL,
    sort INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    remark TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS live_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL,
    sort INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
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

const dropAppTablesSql = `
  DROP TABLE IF EXISTS vod_sources;
  DROP TABLE IF EXISTS live_sources;
  DROP TABLE IF EXISTS recent_plays;
  DROP TABLE IF EXISTS favorites;
  DROP TABLE IF EXISTS settings;
`

export function createDatabase(): AppDatabase {
  const dbDir = join(app.getPath('userData'), 'database')
  mkdirSync(dbDir, { recursive: true })

  const databasePath = join(dbDir, DB_FILE_NAME)

  const sqlite = new Database(databasePath)
  // WAL 允许读取与写入并行，降低播放记录等频繁小写入对 UI 的影响。
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(createSchemaSql)

  return drizzle(sqlite, { schema })
}

export function resetAppDatabase(db: AppDatabase): void {
  // 此操作不可逆；调用方须先完成用户确认与必要的备份流程。
  db.$client.exec(dropAppTablesSql)
  db.$client.exec(createSchemaSql)
}
