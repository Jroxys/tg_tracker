const fs = require('fs');
const path = require('path');
const db = require('./db');
const { llmGenerateWords, llmGenerateGenericTask, GROQ_API_KEY } = require('./llm');

const frenchWords = require('./frenchWords.js');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tierFromDifficulty(score) {
  return Math.min(5, Math.max(1, Math.ceil(score / 20)));
}

// ---- Kelime havuzundan yerel seçim (LLM yoksa / başarısız olursa fallback) ----
function pickWordsLocal(trackId, tier, count) {
  const pool = frenchWords[String(tier)];
  const seenRows = db.prepare('SELECT word FROM word_progress WHERE track_id = ?').all(trackId);
  const seenWords = new Set(seenRows.map(r => r.word));
  const fresh = pool.filter(([w]) => !seenWords.has(w));
  const chosen = [];
  const shuffled = [...fresh].sort(() => Math.random() - 0.5);
  while (chosen.length < count && shuffled.length) chosen.push(shuffled.pop());
  if (chosen.length < count) {
    const rest = [...pool].sort(() => Math.random() - 0.5);
    for (const pair of rest) {
      if (chosen.length >= count) break;
      if (!chosen.includes(pair)) chosen.push(pair);
    }
  }
  return chosen;
}

function recordWords(trackId, words) {
  const seenRows = db.prepare('SELECT word FROM word_progress WHERE track_id = ?').all(trackId);
  const seenWords = new Set(seenRows.map(r => r.word));
  const insertStmt = db.prepare(`
    INSERT INTO word_progress (track_id, word, translation, seen_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT DO NOTHING
  `);
  const updateStmt = db.prepare(`UPDATE word_progress SET seen_count = seen_count + 1 WHERE track_id = ? AND word = ?`);
  for (const [w, t] of words) {
    if (seenWords.has(w)) updateStmt.run(trackId, w);
    else insertStmt.run(trackId, w, t);
  }
}

function getRecentNotes(chatId, days = 3) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT content FROM journal_entries WHERE chat_id = ? AND entry_date >= ? ORDER BY created_at DESC LIMIT 5`
  ).all(String(chatId), since);
  return rows.map(r => r.content).join(' | ');
}

async function generateTaskDescription(track) {
  const tier = tierFromDifficulty(track.difficulty_score);
  const recentNotes = getRecentNotes(track.chat_id);

  if (track.type === 'language') {
    const count = 6 + tier * 2;
    const seenRows = db.prepare('SELECT word FROM word_progress WHERE track_id = ?').all(track.id);
    const seenWords = seenRows.map(r => r.word);

    let words = null;
    if (GROQ_API_KEY) {
      words = await llmGenerateWords({ trackName: track.name, tier, count, seenWords, recentNotes });
    }
    if (!words || !words.length) {
      words = pickWordsLocal(track.id, tier, count);
    }
    recordWords(track.id, words);
    const list = words.map(([w, t]) => `• ${w} → ${t}`).join('\n');
    return `📘 ${track.name} — ${words.length} kelime (seviye ${tier}/5)\n\n${list}`;
  }

  // generic tip
  let desc = null;
  if (GROQ_API_KEY) {
    desc = await llmGenerateGenericTask({ trackName: track.name, tier, streak: track.streak, recentNotes });
  }
  if (!desc) {
    const minutes = 10 + Math.round((track.difficulty_score / 100) * 50);
    desc = `Bugün ${minutes} dakika ${track.name} üzerinde çalış.`;
  }
  return `🎯 ${track.name} (seviye ${tier}/5)\n\n${desc}`;
}

async function getOrCreateTodayTask(track) {
  const today = todayStr();
  const existing = db.prepare(
    `SELECT * FROM tasks WHERE track_id = ? AND assigned_date = ? AND origin = 'auto'`
  ).get(track.id, today);
  if (existing) return existing;

  const description = await generateTaskDescription(track);
  const info = db.prepare(
    `INSERT INTO tasks (track_id, description, assigned_date, status, origin) VALUES (?, ?, ?, 'pending', 'auto')`
  ).run(track.id, description, today);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid);
}

function addCustomTask(trackId, description) {
  const today = todayStr();
  const info = db.prepare(
    `INSERT INTO tasks (track_id, description, assigned_date, status, origin) VALUES (?, ?, ?, 'pending', 'custom')`
  ).run(trackId, description, today);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid);
}

function getTodayTasks(trackId) {
  const today = todayStr();
  return db.prepare(
    `SELECT * FROM tasks WHERE track_id = ? AND assigned_date = ? ORDER BY id`
  ).all(trackId, today);
}

function adjustDifficulty(track, feedback) {
  let delta = 0;
  if (feedback === 'easy') delta = 8;
  else if (feedback === 'hard') delta = -6;
  else delta = 2;
  if (track.streak >= 5) delta += 2;

  const newScore = Math.min(100, Math.max(0, track.difficulty_score + delta));
  db.prepare(`UPDATE tracks SET difficulty_score = ? WHERE id = ?`).run(newScore, track.id);
  return newScore;
}

// Bir günde birden fazla görev tamamlanabilir ama streak günde SADECE BİR kez artar.
function completeTask(task, track, feedback) {
  db.prepare(
    `UPDATE tasks SET status = 'done', difficulty_feedback = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(feedback, task.id);

  const today = todayStr();
  let newStreak = track.streak;

  if (track.last_streak_date !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (track.last_streak_date && track.last_streak_date !== yesterday) {
      newStreak = 1; // ara verilmiş, sıfırdan başla
    } else {
      newStreak = track.streak + 1;
    }
  }

  const newBest = Math.max(track.best_streak, newStreak);
  db.prepare(
    `UPDATE tracks SET streak = ?, best_streak = ?, last_streak_date = ? WHERE id = ?`
  ).run(newStreak, newBest, today, track.id);
  track.streak = newStreak;

  const newScore = adjustDifficulty(track, feedback);
  return { newStreak, newScore };
}

function journalGrid(trackId, days = 21) {
  const rows = db.prepare(
    `SELECT assigned_date,
            SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done_count,
            COUNT(*) as total
     FROM tasks WHERE track_id = ? GROUP BY assigned_date
     ORDER BY assigned_date DESC LIMIT ?`
  ).all(trackId, days);
  const map = new Map(rows.map(r => [r.assigned_date, r]));
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = map.get(d);
    if (!r) cells.push('❌');
    else if (r.done_count === r.total) cells.push('✅');
    else if (r.done_count > 0) cells.push('🟡');
    else cells.push('⬜');
  }
  return cells.join('');
}

// ---- Serbest günlük notları ----
function addNote(chatId, content) {
  const today = todayStr();
  db.prepare(
    `INSERT INTO journal_entries (chat_id, entry_date, content) VALUES (?, ?, ?)`
  ).run(String(chatId), today, content);
}

function listNotes(chatId, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db.prepare(
    `SELECT entry_date, content, created_at FROM journal_entries
     WHERE chat_id = ? AND entry_date >= ? ORDER BY created_at DESC`
  ).all(String(chatId), since);
}

// ---- Hatırlatma sistemi için: bugün hiç hatırlatma gönderilmemiş aktif track'ler ----
function getTracksNeedingReminder() {
  const today = todayStr();
  return db.prepare(
    `SELECT * FROM tracks WHERE active = 1 AND (last_reminder_date IS NULL OR last_reminder_date != ?)`
  ).all(today);
}

function markReminded(trackId) {
  db.prepare(`UPDATE tracks SET last_reminder_date = ? WHERE id = ?`).run(todayStr(), trackId);
}

module.exports = {
  todayStr,
  tierFromDifficulty,
  generateTaskDescription,
  getOrCreateTodayTask,
  addCustomTask,
  getTodayTasks,
  completeTask,
  adjustDifficulty,
  journalGrid,
  addNote,
  listNotes,
  getTracksNeedingReminder,
  markReminded,
};
