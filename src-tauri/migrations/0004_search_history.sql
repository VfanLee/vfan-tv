CREATE TABLE search_history (
    keyword TEXT PRIMARY KEY CHECK(length(trim(keyword)) > 0),
    searched_at INTEGER NOT NULL
);
CREATE INDEX search_history_searched_at ON search_history(searched_at DESC);
