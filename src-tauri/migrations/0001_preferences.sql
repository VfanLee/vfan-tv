-- 新应用数据库，不导入 Electron 数据
PRAGMA application_id = 1447441494;

CREATE TABLE ui_preferences (
    scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
    key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
    value TEXT NOT NULL CHECK (json_valid(value)),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
);
