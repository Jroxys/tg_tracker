const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function callGroq(systemPrompt, userPrompt) {
  if (!GROQ_API_KEY) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      console.error('Groq API hata:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('Groq çağrısı başarısız:', e.message);
    return null;
  }
}

// Dil track'i için LLM'den kelime listesi üret (JSON formatında)
async function llmGenerateWords({ trackName, tier, count, seenWords, recentNotes }) {
  const system =
    `Sen bir dil öğretmenisin. Kullanıcıya SADECE geçerli JSON döndür, başka hiçbir metin ekleme. ` +
    `Format: {"words":[{"w":"kelime","t":"türkçe çeviri"}, ...]} tam olarak ${count} adet.`;
  const user =
    `Dil: ${trackName}. Zorluk seviyesi: ${tier}/5 (1=çok temel, 5=ileri düzey/soyut kavramlar). ` +
    `Daha önce görülen kelimeler (bunları TEKRARLAMA): ${seenWords.slice(-40).join(', ') || 'yok'}. ` +
    (recentNotes ? `Kullanıcının son günlük notları (ilgi alanlarına göre bağlamsal kelime seçmek için kullan): ${recentNotes}. ` : '') +
    `${count} yeni, seviyeye uygun kelime üret.`;

  const raw = await callGroq(system, user);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.words) || !parsed.words.length) return null;
    return parsed.words
      .filter(x => x.w && x.t)
      .map(x => [String(x.w).trim(), String(x.t).trim()]);
  } catch (e) {
    return null;
  }
}

// Genel track için LLM'den spesifik görev metni üret
async function llmGenerateGenericTask({ trackName, tier, streak, recentNotes }) {
  const system =
    `Sen kullanıcının kişisel gelişim koçusun. Türkçe, tek bir spesifik, ölçülebilir günlük görev üret. ` +
    `Sadece görev cümlesini döndür, açıklama/preamble ekleme, madde işareti kullanma. Maksimum 2 cümle.`;
  const user =
    `Alan: ${trackName}. Zorluk seviyesi: ${tier}/5 (1=çok kolay/kısa, 5=zorlayıcı/uzun). ` +
    `Güncel streak: ${streak} gün. ` +
    (recentNotes ? `Kullanıcının son notları/bağlamı: ${recentNotes}. ` : '') +
    `Bu bilgilere göre bugün için somut, ölçülebilir bir görev yaz (örn: süre, adet, veya net bir eylem içersin).`;

  const raw = await callGroq(system, user);
  return raw || null;
}

module.exports = { llmGenerateWords, llmGenerateGenericTask, GROQ_API_KEY };
