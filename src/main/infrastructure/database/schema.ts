import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const vodSourcesTable = sqliteTable(
  'vod_sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    referer: text('referer'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    sort: integer('sort').notNull(),
    origin: text('origin', { enum: ['manual', 'subscription'] })
      .notNull()
      .default('manual'),
    remark: text('remark'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('vod_sources_url_unique').on(table.url)],
)

export const liveSourcesTable = sqliteTable(
  'live_sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    sort: integer('sort').notNull(),
    origin: text('origin', { enum: ['manual', 'subscription'] })
      .notNull()
      .default('manual'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('live_sources_url_unique').on(table.url)],
)

export const recentPlaysTable = sqliteTable(
  'recent_plays',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceName: text('source_name').notNull(),
    vodId: text('vod_id').notNull(),
    title: text('title').notNull(),
    poster: text('poster'),
    lineName: text('line_name').notNull(),
    episodeName: text('episode_name').notNull(),
    episodeUrl: text('episode_url').notNull(),
    currentTime: integer('current_time').notNull(),
    duration: integer('duration').notNull(),
    rawJson: text('raw_json'),
    playedAt: integer('played_at').notNull(),
  },
  (table) => [
    uniqueIndex('recent_plays_unique_episode').on(table.sourceId, table.vodId, table.lineName, table.episodeName),
  ],
)

export const favoritesTable = sqliteTable(
  'favorites',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url'),
    vodId: text('vod_id').notNull(),
    title: text('title').notNull(),
    poster: text('poster'),
    year: text('year'),
    area: text('area'),
    language: text('language'),
    category: text('category'),
    remarks: text('remarks'),
    actor: text('actor'),
    director: text('director'),
    description: text('description'),
    rawJson: text('raw_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('favorites_unique_vod').on(table.sourceId, table.vodId)],
)
