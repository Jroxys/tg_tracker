# TrackBot

Genel amaçlı, zorluk seviyesini kendine göre ayarlayan Telegram tabanlı takip botu.
Fransızca kelime ezberi, spor, proje çalışması vb. her şey için "track" oluşturabilirsin.
Ayrıca serbest günlük (defter) tutabilir, kendi görevlerini ekleyebilirsin.

## Komutlar

**Track yönetimi**
- `/newtrack <isim> <dil|genel>` — yeni track oluştur (örn: `/newtrack Fransızca dil`)
- `/tracks` — track listesi ve id'leri

**Günlük görevler**
- `/today` — bugünün görevlerini göster (yoksa otomatik oluşturur)
- `/done <task_id>` — görevi tamamla, zorluk feedback ver (kolay/normal/zor)
- `/addtask <track_id> <açıklama>` — bota ek olarak kendi görevini ekle

**Günlük (defter)**
- `/not <metin>` — bugüne dair düşüncelerini/notunu kaydet
- `/diary [gün]` — geçmiş notlarına bak (varsayılan son 7 gün)

**İlerleme**
- `/journal <track_id>` — son 21 günün emoji özeti (✅ tam, 🟡 kısmi, ⬜ yapılmadı, ❌ görev yoktu)
- `/status` — tüm track'lerin genel durumu

---

## Özellikler

- **Adaptif zorluk**: her `/done` sonrası verdiğin kolay/normal/zor feedback'ine göre zorluk skoru (0-100) ayarlanır, bu da görev boyutunu/kapsamını değiştirir.
- **Streak takibi**: günde kaç görev tamamlarsan tamamla, streak günde sadece bir kez artar; bir gün atlarsan sıfırlanır.
- **LLM ile dinamik görev üretimi** (opsiyonel): `GROQ_API_KEY` tanımlarsan görevler gerçek zamanlı, senin son günlük notlarını da dikkate alarak üretilir. Anahtar yoksa ya da API başarısız olursa bot otomatik olarak sabit kelime listesi/süre formülüne döner — hiçbir zaman çalışmaz durumda kalmaz.
- **Kendi görevini ekleme**: bot görevine ek olarak istediğin zaman `/addtask` ile kendi görevini eklersin, aynı gün için birden fazla görev olabilir.
- **Otomatik hatırlatma**: her gün belirlenen saatte (varsayılan 10:00 TR saati), henüz hatırlatma gönderilmemiş track'ler için proaktif mesaj atar.
- **Serbest günlük notu**: task sisteminden bağımsız, o güne dair aklından geçenleri `/not` ile yazabilirsin. Dil track'lerinde bu notlar LLM'e bağlam olarak da veriliyor (örn. ilgi alanına göre kelime seçimi).

---

## Kurulum (telefondan, bilgisayarsız)

### 1. Telegram'dan bot token al (2 dakika)
1. Telegram'da **@BotFather**'ı ara, `/start` yaz.
2. `/newbot` yaz.
3. Botuna bir isim ver (örn: "Omer Track Bot").
4. Bir kullanıcı adı ver, sonu `bot` ile bitmeli (örn: `omertrackbot`).
5. BotFather sana bir **token** verecek, şuna benzer:
   `123456789:AAExampleTokenHereXXXXXXXXXXXXXXXXXXX`
   **Bunu bir yere kaydet, deploy sırasında lazım olacak.**

### 2. (Opsiyonel ama önerilir) Groq API anahtarı al
Dinamik/LLM destekli görev üretimi istersen:
1. console.groq.com adresine git, ücretsiz hesap aç.
2. "API Keys" bölümünden yeni bir anahtar oluştur, kopyala.
3. Groq'un ücretsiz katmanı bu kullanım için fazlasıyla yeterli.
Bu adımı atlarsan bot yine çalışır, sadece görevler sabit listeden gelir.

### 3. Kodu GitHub'a yükle (tarayıcıdan)
1. github.com'a git, hesabın yoksa ücretsiz oluştur.
2. Sağ üstten **"+"** → **"New repository"**.
3. İsim ver (örn: `trackbot`), **Private** seç, "Create repository" de.
4. Açılan sayfada **"uploading an existing file"** linkine tıkla.
5. Bu projedeki tüm dosyaları sürükle-bırak ile yükle.
   - `node_modules` klasörünü **yükleme**, gerek yok (Railway kendisi kuracak).
6. Alt kısımda "Commit changes" de.

### 4. Railway'e deploy et (tarayıcıdan)
1. railway.app adresine git, **"Login with GitHub"** ile giriş yap.
2. **"New Project"** → **"Deploy from GitHub repo"** → `trackbot` reposunu seç.
3. Railway otomatik olarak `package.json`'ı görüp Node.js projesi olduğunu anlayacak.
4. Sol menüden **"Variables"** sekmesine git, sırasıyla ekle:
   - `TELEGRAM_BOT_TOKEN` = (1. adımda aldığın token)
   - `GROQ_API_KEY` = (2. adımda aldıysan, yoksa boş bırak)
5. **"Deploy"** butonuna bas (yoksa otomatik başlar).
6. Loglarda `Bot çalışıyor...` yazısını görmelisin — bot artık 7/24 ayakta.

### 5. Test et
Telegram'da botunu bul, `/start` yaz, `/newtrack Fransızca dil` ile ilk track'ini oluştur.

---

## Not: Veritabanı kalıcılığı
Railway'in ücretsiz planında dosya sistemi bazen deploy'lar arası sıfırlanabilir.
Eğer birkaç gün sonra verilerin (streak, geçmiş, notlar) sıfırlandığını görürsen,
Railway'de **"Volumes"** özelliğini `data/` klasörüne bağlaman gerekir
(Railway dashboard → Settings → Volumes → Add Volume, mount path: `/app/data`).
Bu, ücretsiz planda da mevcuttur ve verinin kalıcı diskte tutulmasını sağlar.

## Sonraki adımlar (istersen)
- Haftalık otomatik özet mesajı (ör. her Pazar: "6/7 gün tamamladın")
- Birden fazla dil desteği (data/ altına yeni kelime listesi eklemek yeterli)
- Notlara göre otomatik "bu hafta neye odaklandın" özeti (LLM ile)
