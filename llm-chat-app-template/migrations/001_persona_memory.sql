CREATE TABLE IF NOT EXISTS persona_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	base_instruction TEXT NOT NULL,
	language TEXT NOT NULL CHECK (language IN ('fa', 'en')),
	tone TEXT NOT NULL CHECK (tone IN ('friendly', 'formal')),
	style TEXT NOT NULL CHECK (style IN ('concise', 'detailed')),
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_memories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	memory_text TEXT NOT NULL,
	weight REAL NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_turns (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
	content TEXT NOT NULL,
	created_at TEXT NOT NULL
);

INSERT INTO persona_state (id, base_instruction, language, tone, style, updated_at)
VALUES (
	1,
	'Behave as a practical, calm assistant. Adapt to user preferences and maintain consistency.',
	'fa',
	'friendly',
	'concise',
	datetime('now')
)
ON CONFLICT(id) DO NOTHING;
