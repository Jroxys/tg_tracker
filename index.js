require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./db');
const {
  getOrCreateTodayTask,
  addCustomTask,
  getTodayTasks,
  completeTask,
  journalGrid,
  tierFromDifficulty,
  addNote,
  listNotes,
  getTracksNeedingReminder,
  markReminded,
} = require('./trackLogic');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('HATA: TELEGRAM_BOT_TOKEN tanımlı değil (.env dosyasına bak)');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('Bot çalışıyor...');
if (!process.env.GROQ_API_KEY) {
  console.log('Not: GROQ_API_KEY tanımlı değil, görevler sabit listeden üretilecek (fallback mod).');
}

function getTracks(chatId, activeOnly = true) {
  const q = activeOnly
    ? `SELECT * FROM tracks WHERE chat_id = ? AND active = 1 ORDER BY id`
    : `SELECT * FROM tracks WHERE chat_id = ? ORDER BY id`;
  return db.prepare(q).all(String(chatId));
}

function getTrackById(id) {
  return db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(id);
}

function taskLine(task) {
  const tag = task.origin === 'custom' ? '📝' : '🤖';
  const status = task.status === 'done' ? ' ✅' : '';
  return `${tag} [#${task.id}]${status} ${task.description}`;
}

// ---- /start ----
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `👋 Merhaba! Ben senin kişisel task takip botunum.\n\n` +
    `📌 Track yönetimi\n` +
    `/newtrack <isim> <dil|genel> — yeni takip alanı oluştur\n` +
    `/tracks — track listesi ve id'leri\n\n` +
    `✅ Günlük görevler\n` +
    `/today — bugünün görevlerini göster (yoksa oluşturur)\n` +
    `/done <task_id> — görevi tamamla\n` +
    `/addtask <track_id> <açıklama> — kendi görevini ekle\n\n` +
    `📖 Günlük (defter)\n` +
    `/not <metin> — bugüne dair bir not/düşünce yaz\n` +
    `/diary [gün] — geçmiş notlarına bak (varsayılan 7 gün)\n\n` +
    `📊 İlerleme\n` +
    `/journal <track_id> — son 21 günün özeti\n` +
    `/status — tüm track'lerin genel durumu`
  );
});

// ---- /newtrack ----
bot.onText(/\/newtrack (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const parts = match[1].trim().split(/\s+/);
  const lastWord = parts[parts.length - 1].toLowerCase();
  const isTyped = ['dil', 'genel'].includes(lastWord);
  const type = lastWord === 'dil' ? 'language' : 'generic';
  const nameParts = isTyped ? parts.slice(0, -1) : parts;
  const name = nameParts.join(' ');

  if (!name) {
    bot.sendMessage(chatId, 'Kullanım: /newtrack <isim> <dil|genel>\nÖrnek: /newtrack Fransızca dil');
    return;
  }

  const info = db.prepare(
    `INSERT INTO tracks (chat_id, name, type) VALUES (?, ?, ?)`
  ).run(String(chatId), name, type);

  bot.sendMessage(chatId,
    `✅ "${name}" track'i oluşturuldu (id: ${info.lastInsertRowid}, tip: ${type === 'language' ? 'dil öğrenimi' : 'genel'})\n\n` +
    `Görevini görmek için /today yaz.`
  );
});

// ---- /tracks ----
bot.onText(/\/tracks/, (msg) => {
  const chatId = msg.chat.id;
  const tracks = getTracks(chatId);
  if (!tracks.length) {
    bot.sendMessage(chatId, 'Henüz hiç track yok. /newtrack <isim> <dil|genel> ile oluşturabilirsin.');
    return;
  }
  const lines = tracks.map(t =>
    `#${t.id} — ${t.name} (${t.type === 'language' ? 'dil' : 'genel'}) — 🔥${t.streak} gün — seviye ${tierFromDifficulty(t.difficulty_score)}/5`
  );
  bot.sendMessage(chatId, lines.join('\n'));
});

// ---- /today ----
bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;
  const tracks = getTracks(chatId);
  if (!tracks.length) {
    bot.sendMessage(chatId, 'Henüz hiç track yok. /newtrack <isim> <dil|genel> ile başla.');
    return;
  }
  for (const track of tracks) {
    await getOrCreateTodayTask(track); // eksikse oluşturur
    const tasks = getTodayTasks(track.id);
    const header = `— ${track.name} —`;
    const body = tasks.map(taskLine).join('\n');
    bot.sendMessage(chatId, `${header}\n${body}`);
  }
});

// ---- /addtask <track_id> <açıklama> ----
bot.onText(/\/addtask (\d+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const trackId = parseInt(match[1], 10);
  const description = match[2].trim();
  const track = getTrackById(trackId);

  if (!track || String(track.chat_id) !== String(chatId)) {
    bot.sendMessage(chatId, 'Böyle bir track bulunamadı. /tracks ile listeye bak.');
    return;
  }

  const task = addCustomTask(trackId, description);
  bot.sendMessage(chatId, `📝 Eklendi: [#${task.id}] ${description}\n\nTamamlayınca /done ${task.id}`);
});

// ---- /done <task_id> ----
bot.onText(/\/done (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const taskId = parseInt(match[1], 10);
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);

  if (!task) {
    bot.sendMessage(chatId, 'Böyle bir görev bulunamadı.');
    return;
  }
  const track = getTrackById(task.track_id);
  if (!track || String(track.chat_id) !== String(chatId)) {
    bot.sendMessage(chatId, 'Bu görev sana ait değil.');
    return;
  }
  if (task.status === 'done') {
    bot.sendMessage(chatId, 'Bu görev zaten tamamlanmış ✅');
    return;
  }

  bot.sendMessage(chatId, 'Nasıl geçti?', {
    reply_markup: {
      inline_keyboard: [[
        { text: '😌 Kolay', callback_data: `fb:${task.id}:${track.id}:easy` },
        { text: '🙂 Normal', callback_data: `fb:${task.id}:${track.id}:ok` },
        { text: '😓 Zor', callback_data: `fb:${task.id}:${track.id}:hard` },
      ]]
    }
  });
});

// ---- zorluk feedback callback ----
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const [prefix, taskId, trackId, feedback] = query.data.split(':');
  if (prefix !== 'fb') return;

  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  const track = getTrackById(trackId);
  if (!task || !track) return;

  const { newStreak, newScore } = completeTask(task, track, feedback);
  const tier = tierFromDifficulty(newScore);

  bot.answerCallbackQuery(query.id, { text: 'Kaydedildi ✅' });
  bot.sendMessage(chatId,
    `🎉 Harika! "${track.name}" tamamlandı.\n` +
    `🔥 Streak: ${newStreak} gün\n` +
    `📈 Zorluk seviyesi: ${tier}/5 (skor: ${newScore})`
  );
});

// ---- /not <metin> — günlük notu ----
bot.onText(/\/not (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const content = match[1].trim();
  addNote(chatId, content);
  bot.sendMessage(chatId, '📖 Not kaydedildi.');
});

// ---- /diary [gün] ----
bot.onText(/\/diary(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const days = match[1] ? parseInt(match[1], 10) : 7;
  const notes = listNotes(chatId, days);
  if (!notes.length) {
    bot.sendMessage(chatId, `Son ${days} günde not bulunamadı. /not <metin> ile ekleyebilirsin.`);
    return;
  }
  const lines = notes.map(n => `🗓 ${n.entry_date}\n${n.content}`);
  bot.sendMessage(chatId, `📖 Son ${days} gün:\n\n${lines.join('\n\n')}`);
});

// ---- /journal <track_id> ----
bot.onText(/\/journal (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const trackId = parseInt(match[1], 10);
  const track = getTrackById(trackId);
  if (!track || String(track.chat_id) !== String(chatId)) {
    bot.sendMessage(chatId, 'Böyle bir track bulunamadı.');
    return;
  }
  const grid = journalGrid(trackId, 21);
  bot.sendMessage(chatId,
    `📊 ${track.name} — son 21 gün\n\n${grid}\n\n` +
    `🔥 Güncel streak: ${track.streak} | 🏆 En iyi: ${track.best_streak}\n` +
    `(✅ tam gün, 🟡 kısmi, ⬜ görev vardı ama yapılmadı, ❌ görev yoktu)`
  );
});

// ---- /status ----
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const tracks = getTracks(chatId);
  if (!tracks.length) {
    bot.sendMessage(chatId, 'Henüz hiç track yok.');
    return;
  }
  const lines = tracks.map(t => {
    const tier = tierFromDifficulty(t.difficulty_score);
    return `📌 ${t.name}\n   🔥 ${t.streak} gün (en iyi: ${t.best_streak}) | seviye ${tier}/5`;
  });
  bot.sendMessage(chatId, lines.join('\n\n'));
});

// ---- Otomatik günlük hatırlatma (cron) ----
// Varsayılan: her gün 07:00 UTC (Türkiye yazında UTC+3 -> 10:00). REMINDER_CRON ile özelleştirilebilir.
const reminderCron = process.env.REMINDER_CRON || '0 7 * * *';
cron.schedule(reminderCron, async () => {
  const tracksToRemind = getTracksNeedingReminder();
  for (const track of tracksToRemind) {
    try {
      const task = await getOrCreateTodayTask(track);
      await bot.sendMessage(track.chat_id,
        `☀️ Günaydın! Bugünün görevi hazır:\n\n${task.description}\n\nTamamlayınca /done ${task.id}`
      );
      markReminded(track.id);
    } catch (e) {
      console.error(`Hatırlatma gönderilemedi (track ${track.id}):`, e.message);
    }
  }
});
console.log(`Hatırlatma zamanlaması aktif: "${reminderCron}" (cron formatı, UTC)`);

process.on('unhandledRejection', (err) => console.error('Unhandled:', err));
