-- 更新检查独立于观看进度，删除观看记录时一并清理。
CREATE TABLE recent_updates (
    source_id TEXT NOT NULL,
    vod_id TEXT NOT NULL,
    latest_detail TEXT NOT NULL CHECK (json_valid(latest_detail) AND json_type(latest_detail) = 'object'),
    checked_at INTEGER NOT NULL CHECK (checked_at >= 0),
    max_episode_count INTEGER NOT NULL CHECK (max_episode_count >= 0),
    pending_episode_count INTEGER NOT NULL CHECK (pending_episode_count >= 0),
    known_episode_keys TEXT NOT NULL CHECK (json_valid(known_episode_keys) AND json_type(known_episode_keys) = 'array'),
    pending_episode_keys TEXT NOT NULL CHECK (json_valid(pending_episode_keys) AND json_type(pending_episode_keys) = 'array'),
    revision TEXT NOT NULL CHECK (length(revision) > 0),
    source_config TEXT NOT NULL,
    PRIMARY KEY (source_id, vod_id),
    FOREIGN KEY (source_id, vod_id) REFERENCES recent_plays(source_id, vod_id) ON DELETE CASCADE
) STRICT;
