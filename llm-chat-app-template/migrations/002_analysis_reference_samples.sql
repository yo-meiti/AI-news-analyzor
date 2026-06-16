CREATE TABLE IF NOT EXISTS analysis_reference_samples (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	news_input TEXT NOT NULL,
	analysis_text TEXT NOT NULL,
	strategic_depth REAL,
	practical_decision_value REAL,
	intellectual_honesty REAL,
	average_score REAL,
	archive_worthy INTEGER NOT NULL CHECK (archive_worthy IN (0, 1)),
	created_at TEXT NOT NULL
);
