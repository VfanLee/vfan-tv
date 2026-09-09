CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('vod', 'iptv')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    url TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    headers TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(headers)),
    backups TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(backups)),
    sort INTEGER NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'subscription')),
    remark TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(kind, url)
);
CREATE INDEX sources_kind_sort ON sources(kind, sort);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    sort INTEGER NOT NULL
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL CHECK (json_valid(value))
);

CREATE TABLE proxy_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https', 'socks5')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    sort INTEGER NOT NULL
);
CREATE TABLE network_routes (
    route TEXT PRIMARY KEY CHECK (route = 'iptv'),
    mode TEXT NOT NULL CHECK (mode IN ('direct', 'system', 'custom')),
    active_profile_id TEXT REFERENCES proxy_profiles(id)
);
INSERT INTO network_routes (route, mode) VALUES ('iptv', 'direct');
