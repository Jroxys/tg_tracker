const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'trackbot.db'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  difficulty_score INTEGER NOT NULL DEFAULT 30,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_streak_date TEXT,
  last_reminder_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  assigned_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  origin TEXT NOT NULL DEFAULT 'auto',
  difficulty_feedback TEXT,
  completed_at TEXT,
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE TABLE IF NOT EXISTS word_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  translation TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_track_date ON tasks(track_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_tracks_chat ON tracks(chat_id);
CREATE INDEX IF NOT EXISTS idx_journal_chat_date ON journal_entries(chat_id, entry_date);
`);

// Var olan eski veritabanlarında yeni kolonlar eksikse ekle (migration)
function tryAlter(sql) {
  try { db.exec(sql); } catch (e) { /* kolon zaten varsa hata verir, yok say */ }
}
tryAlter(`ALTER TABLE tracks ADD COLUMN last_streak_date TEXT`);
tryAlter(`ALTER TABLE tracks ADD COLUMN last_reminder_date TEXT`);
tryAlter(`ALTER TABLE tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'auto'`);

module.exports = db;
