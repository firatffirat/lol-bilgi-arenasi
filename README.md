# LoL Bilgi Arenası

Arkadaş grubuna özel, tarayıcıdan oynanan çevrimiçi LoL bilgi yarışması. Node.js + Express + Socket.IO kullanır. Arayüz mobil uyumludur.

## Özellikler
- Oda oluşturma ve 6 haneli kodla katılma
- Oda başına en fazla 5 oyuncu
- Oda sahibi ve hazır / hazır değil akışı
- 30 soruluk tek yarışma; sorular her maçta karıştırılır
- Her soru için sunucu saatine göre 20 saniye
- Sunucu tarafında cevap doğrulama ve puanlama
- Doğru cevap: 100 puan + kalan süreye göre en fazla 50 hız bonusu
- Yanlış / cevapsız: 0 puan
- Cevap kilidi, cevap açıklama ekranı, canlı cevap durumu ve final sıralaması
- Telefon ve masaüstü uyumlu LoL esintili arayüz

## Yerelde çalıştırma
Node.js 18 veya üzeri gerekir.

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresini aç. Aynı ağdaki telefonlar bilgisayarın yerel IP adresiyle bağlanabilir.

## Render'a yayınlama
1. Projeyi GitHub deposuna yükle.
2. Render'da **New > Web Service** seçip depoyu bağla.
3. Runtime: Node; Build Command: `npm install`; Start Command: `npm start`.
4. Deploy tamamlanınca verilen HTTPS adresini açıp arkadaşlarınla paylaş.

Socket.IO aynı web servisi üzerinde çalışır; ayrı veritabanı veya Redis gerekmez. Oda bilgileri sunucu belleğinde tutulduğu için servis yeniden başlatılırsa açık odalar kapanır.

## Oyun akışı
Oda sahibi oda kurar. Diğerleri 6 haneli kodla katılır. Herkes hazır olduğunda oda sahibi başlatır. Herkes aynı soruyu aynı anda görür. Cevaplar sunucu tarafından kontrol edilir; süre dolunca veya herkes cevaplayınca doğru seçenek gösterilir. 30. sorudan sonra sıralama yayınlanır.

## Soru havuzunu düzenleme
`questions.js` dosyasında 30 soru bulunur. Her soru şu biçimdedir:

```js
{ q: "Soru metni", o: ["A", "B", "C", "D"], a: 0 }
```

`a` alanı doğru seçeneğin sıfırdan başlayan indeksidir. Cevap anahtarı istemciye gönderilmez.

## Notlar
- Bu bağımsız hayran projesidir; Riot Games ile bağlantılı veya Riot tarafından onaylanmış değildir.
- Arkadaşlara özel sorular, kullanıcının bu konuşmada paylaştığı grup anılarından oluşturulmuştur. Kişisel/iddia niteliğindeki içerikler oyun içi şaka bağlamında tutulmuştur.
- Bu ilk sürümde kalıcı hesap sistemi ve yeniden başlatma sonrası oda kurtarma yoktur.
