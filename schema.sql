CREATE TABLE IF NOT EXISTS saved_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_hash TEXT UNIQUE,
    original_url TEXT,
    author TEXT,
    original_text TEXT,
    category TEXT,
    tags TEXT,
    summary TEXT,
    summary_short TEXT,
    insight TEXT,
    insight_short TEXT,
    sentiment TEXT,
    saved_at TEXT NOT NULL,
    reported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    error_type TEXT,
    resolved INTEGER DEFAULT 0
);
