-- Vfan TV 首个正式版本的完整数据库结构；不兼容旧架构或开发期数据库
PRAGMA application_id = 1447441494;

CREATE TABLE ui_preferences (
    scope TEXT NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 64),
    key TEXT NOT NULL CHECK (length(trim(key)) BETWEEN 1 AND 128),
    value TEXT NOT NULL CHECK (json_valid(value)),
    PRIMARY KEY (scope, key)
) STRICT;

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    url TEXT NOT NULL UNIQUE CHECK (length(trim(url)) > 0),
    sort INTEGER NOT NULL CHECK (sort >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    synced_at INTEGER CHECK (synced_at >= 0)
) STRICT;

CREATE TABLE sources (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('vod', 'iptv')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    url TEXT NOT NULL CHECK (length(trim(url)) > 0),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    headers TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(headers) AND json_type(headers) = 'object'),
    backups TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(backups) AND json_type(backups) = 'array'),
    sort INTEGER NOT NULL CHECK (sort >= 0),
    subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,
    remark TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    UNIQUE (kind, url)
) STRICT;

CREATE TABLE proxy_profiles (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https', 'socks5')),
    host TEXT NOT NULL CHECK (length(trim(host)) > 0),
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    sort INTEGER NOT NULL CHECK (sort >= 0)
) STRICT;

CREATE TABLE network_routes (
    route TEXT PRIMARY KEY NOT NULL CHECK (length(trim(route)) > 0),
    mode TEXT NOT NULL CHECK (mode IN ('direct', 'system', 'custom')),
    active_profile_id TEXT REFERENCES proxy_profiles(id),
    CHECK (mode <> 'custom' OR active_profile_id IS NOT NULL)
) STRICT;

-- 每个源中的视频独立保存进度，同名作品不再互相覆盖
CREATE TABLE recent_plays (
    source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
    source_name TEXT NOT NULL,
    vod_id TEXT NOT NULL CHECK (length(trim(vod_id)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    poster TEXT,
    line_name TEXT NOT NULL,
    episode_name TEXT NOT NULL,
    episode_url TEXT NOT NULL,
    position_seconds REAL NOT NULL CHECK (position_seconds >= 0 AND position_seconds <= 1.7976931348623157e308),
    duration REAL NOT NULL CHECK (duration >= 0 AND duration <= 1.7976931348623157e308),
    raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
    played_at INTEGER NOT NULL CHECK (played_at >= 0),
    PRIMARY KEY (source_id, vod_id)
) STRICT;

CREATE TABLE favorites (
    source_id TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
    vod_id TEXT NOT NULL CHECK (length(trim(vod_id)) > 0),
    source_name TEXT NOT NULL,
    source_url TEXT,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    poster TEXT,
    year TEXT,
    area TEXT,
    language TEXT,
    category TEXT,
    remarks TEXT,
    actor TEXT,
    director TEXT,
    description TEXT,
    raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    PRIMARY KEY (source_id, vod_id)
) STRICT;

CREATE TABLE search_history (
    keyword TEXT PRIMARY KEY NOT NULL CHECK (length(trim(keyword)) > 0),
    searched_at INTEGER NOT NULL CHECK (searched_at >= 0)
) STRICT;

INSERT INTO network_routes (route, mode) VALUES ('iptv', 'direct');

CREATE INDEX sources_kind_sort ON sources (kind, sort);
CREATE INDEX sources_subscription ON sources (subscription_id);
CREATE INDEX recent_plays_played_at ON recent_plays (played_at DESC);
CREATE INDEX favorites_updated_at ON favorites (updated_at DESC);
CREATE INDEX search_history_searched_at ON search_history (searched_at DESC);

-- 所有删除入口（包括订阅级联）在同一事务内清理对应选择，不删除用户资料
CREATE TRIGGER sources_cleanup_preferences AFTER DELETE ON sources
BEGIN
    DELETE FROM ui_preferences
    WHERE (scope = CASE OLD.kind WHEN 'vod' THEN 'catalog' ELSE 'iptv' END
           AND key = 'selectedSource' AND json_extract(value, '$') = OLD.id)
       OR (OLD.kind = 'iptv' AND scope = 'iptv-selection' AND key = OLD.id);
END;
