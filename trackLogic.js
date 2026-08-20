const db = require('./db');
const frenchWords = require('./frenchWords.js');
const { llmGenerateWords, llmGenerateGenericTask, GROQ_API_KEY } = require('./llm');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tierFromDifficulty(score) {
  return Math.min(5, Math.max(1, Math.ceil(score / 20)));
}

// ---- Kelime havuzundan yerel seçim (LLM yoksa / başarısız olursa fallback) ----
function pickWordsLocal(trackId, tier, count) {
  const pool = frenchWords[String(tier)];
  const seenWords = new Set(db.wordProgress.all(r => r.track_id === trackId).map(r => r.word));
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
  for (const [w, t] of words) {
    const existing = db.wordProgress.find(r => r.track_id === trackId && r.word === w);
    if (existing) {
      db.wordProgress.update(existing.id, { seen_count: existing.seen_count + 1 });
    } else {
      db.wordProgress.insert({ track_id: trackId, word: w, translation: t, seen_count: 1, first_seen: new Date().toISOString() });
    }
  }
}

function getRecentNotes(chatId, days = 3) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.journalEntries
    .all(r => r.chat_id === String(chatId) && r.entry_date >= since)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);
  return rows.map(r => r.content).join(' | ');
}

async function generateTaskDescription(track) {
  const tier = tierFromDifficulty(track.difficulty_score);
  const recentNotes = getRecentNotes(track.chat_id);

  if (track.type === 'language') {
    const count = 6 + tier * 2;
    const seenWords = db.wordProgress.all(r => r.track_id === track.id).map(r => r.word);

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
  const existing = db.tasks.find(t => t.track_id === track.id && t.assigned_date === today && t.origin === 'auto');
  if (existing) return existing;

  const description = await generateTaskDescription(track);
  return db.tasks.insert({
    track_id: track.id,
    description,
    assigned_date: today,
    status: 'pending',
    origin: 'auto',
    difficulty_feedback: null,
    completed_at: null,
  });
}

function addCustomTask(trackId, description) {
  const today = todayStr();
  return db.tasks.insert({
    track_id: trackId,
    description,
    assigned_date: today,
    status: 'pending',
    origin: 'custom',
    difficulty_feedback: null,
    completed_at: null,
  });
}

function getTodayTasks(trackId) {
  const today = todayStr();
  return db.tasks
    .all(t => t.track_id === trackId && t.assigned_date === today)
    .sort((a, b) => a.id - b.id);
}

function adjustDifficulty(track, feedback) {
  let delta = 0;
  if (feedback === 'easy') delta = 8;
  else if (feedback === 'hard') delta = -6;
  else delta = 2;
  if (track.streak >= 5) delta += 2;

  const newScore = Math.min(100, Math.max(0, track.difficulty_score + delta));
  db.tracks.update(track.id, { difficulty_score: newScore });
  return newScore;
}

// Bir günde birden fazla görev tamamlanabilir ama streak günde SADECE BİR kez artar.
function completeTask(task, track, feedback) {
  db.tasks.update(task.id, { status: 'done', difficulty_feedback: feedback, completed_at: new Date().toISOString() });

  const today = todayStr();
  let newStreak = track.streak;

  if (track.last_streak_date !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (track.last_streak_date && track.last_streak_date !== yesterday) {
      newStreak = 1;
    } else {
      newStreak = track.streak + 1;
    }
  }

  const newBest = Math.max(track.best_streak, newStreak);
  db.tracks.update(track.id, { streak: newStreak, best_streak: newBest, last_streak_date: today });
  track.streak = newStreak;

  const newScore = adjustDifficulty(track, feedback);
  return { newStreak, newScore };
}

function journalGrid(trackId, days = 21) {
  const rows = db.tasks.all(t => t.track_id === trackId);
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.assigned_date)) byDate.set(r.assigned_date, { done: 0, total: 0 });
    const entry = byDate.get(r.assigned_date);
    entry.total += 1;
    if (r.status === 'done') entry.done += 1;
  }
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const entry = byDate.get(d);
    if (!entry) cells.push('❌');
    else if (entry.done === entry.total) cells.push('✅');
    else if (entry.done > 0) cells.push('🟡');
    else cells.push('⬜');
  }
  return cells.join('');
}

// ---- Serbest günlük notları ----
function addNote(chatId, content) {
  const today = todayStr();
  db.journalEntries.insert({ chat_id: String(chatId), entry_date: today, content, created_at: new Date().toISOString() });
}

function listNotes(chatId, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return db.journalEntries
    .all(r => r.chat_id === String(chatId) && r.entry_date >= since)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// ---- Hatırlatma sistemi için: bugün hiç hatırlatma gönderilmemiş aktif track'ler ----
function getTracksNeedingReminder() {
  const today = todayStr();
  return db.tracks.all(t => t.active === 1 && (!t.last_reminder_date || t.last_reminder_date !== today));
}

function markReminded(trackId) {
  db.tracks.update(trackId, { last_reminder_date: todayStr() });
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
