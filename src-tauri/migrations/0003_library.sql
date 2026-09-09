CREATE TABLE recent_plays (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    vod_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL UNIQUE,
    poster TEXT,
    line_name TEXT NOT NULL,
    episode_name TEXT NOT NULL,
    episode_url TEXT NOT NULL,
    current_time REAL NOT NULL CHECK(current_time >= 0),
    duration REAL NOT NULL CHECK(duration >= 0),
    raw_json TEXT,
    played_at INTEGER NOT NULL CHECK(played_at >= 0)
);
CREATE INDEX recent_plays_played_at ON recent_plays(played_at DESC);

CREATE TABLE favorites (
    id TEXT PRIMARY KEY,
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
CREATE INDEX favorites_updated_at ON favorites(updated_at DESC);
