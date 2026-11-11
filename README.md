# Asisten Kuota

Prototype asisten AI untuk MyTelkomsel yang dapat membantu pelanggan memeriksa
kuota dan jaringan, melihat tiket gangguan, serta memilih paket. Proyek ini
menggunakan Node.js, Express, SQLite, dan model AI melalui API yang kompatibel
dengan OpenAI.

## Persyaratan

- Node.js 18 atau lebih baru dan npm
- Endpoint model AI yang kompatibel dengan OpenAI, misalnya Ollama lokal atau
  layanan AI lain seperti octa.telkomsel.com

## Instalasi dan menjalankan server

1. Clone repository dan masuk ke direktori proyek:

    ```bash
    git clone https://github.com/MursalHabib/asisten-kuota.git
    cd asisten-kuota
    ```

2. Pasang dependency:

    ```bash
    npm install
    ```

3. Buat file konfigurasi lokal dari contoh:

    ```bash
    cp .env.example .env
    ```

4. Ubah nilai konfigurasi model AI yang kosong di `.env` (edit baris yang
   sudah ada, jangan menambahkan duplikat). Contoh untuk Ollama yang berjalan
   di komputer yang sama:

    ```dotenv
    PORT=8080
    OPENAI_BASE_URL=http://localhost:11434/v1
    OPENAI_API_KEY=
    OPENAI_MODEL=qwen3.5:latest
    ```

    Pastikan Ollama berjalan dan model yang dipilih sudah tersedia. Untuk
    layanan AI kompatibel OpenAI, seperti dari Octa Telkomsel, isi `OPENAI_BASE_URL`, `OPENAI_API_KEY`, dan
    `OPENAI_MODEL`. Jangan commit file `.env` atau API key ke repository.

5. Jalankan server:

    ```bash
    node src/app.js
    atau
    npm start
    ```

    Server berjalan pada `http://localhost:8080` secara default. Port dapat
    diubah melalui variabel `PORT`. Halaman web statis tersedia dari folder
    `src/public/`.

Database SQLite menggunakan file `database.sqlite` di root proyek. Sejumlah
fitur juga mengakses layanan backend contoh di `http://localhost:3001`; layanan
tersebut harus tersedia untuk endpoint yang bergantung padanya.

## Penggunaan API

Semua route API dipasang dengan prefix `/api`. Endpoint chat AI:

```http
POST /api/agent/chat
Content-Type: application/json
```

Contoh body:

```json
{
	"conversationId": "demo-001",
	"msisdn": "628111111101",
	"message": "Tolong cek kenapa internet saya lambat"
}
```

`msisdn` harus menggunakan format nomor Indonesia yang diawali `62`.
`conversationId` wajib diisi dan dibatasi maksimal 100 karakter, sedangkan
`message` wajib diisi dan dibatasi maksimal 1000 karakter. Contoh respons:

```json
{
	"conversationId": "demo-001",
	"reply": "Silakan balas KONFIRMASI untuk mulai diagnosa, atau BATAL."
}
```

Setelah pembelian paket berhasil, tiket gangguan baru dibuat, atau percakapan
diserahkan ke agent, respons chat dapat menyertakan `ratingPrompt`. Kirim rating
1–5 ke `POST /api/agent/rating` menggunakan `conversationId` yang sama:

```json
{
  "conversationId": "demo-001",
  "promptId": "uuid-dari-ratingPrompt",
  "reason": "purchase",
  "rating": 5
}
```

Nilai `reason` dapat berupa `purchase`, `ticket`, atau `handoff`.

Route API yang tersedia sesuai requirements:

| Method | Endpoint                             | Kegunaan                          |
| ------ | ------------------------------------ | --------------------------------- |
| `GET`  | `/api/v1/subscriber/:msisdn/profile` | Melihat profil pelanggan          |
| `GET`  | `/api/v1/subscriber/:msisdn/quota`   | Melihat kuota pelanggan           |
| `GET`  | `/api/v1/network/status?cell=<lokasi>` | Melihat status jaringan berdasarkan cell/lokasi |
| `GET`  | `/api/v1/network/status?msisdn=<nomor>` | Melihat status jaringan berdasarkan nomor pelanggan |
| `POST` | `/api/v1/ticket`                     | Membuat tiket gangguan            |
| `GET`  | `/api/v1/offers`                     | Melihat penawaran paket           |
| `POST` | `/api/v1/loan/eligibility`           | Memeriksa kelayakan Paket Darurat |
| `POST` | `/api/v1/purchase`                   | Memproses pembelian paket         |

Route API lain yang tersedia untuk mendukung pembuatan project ini:
| Method | Endpoint | Kegunaan |
| --- | --- | --- |
| `POST` | `/api/v1/subscriber` | Membuat data pelanggan |
| `POST` | `/api/v1/quota` | Membuat data kuota |
| `POST` | `/api/v1/quota/:msisdn` | Menghapus data kuota pelanggan |
| `POST` | `/api/v1/network/status` | Menambahkan status jaringan |
| `GET` | `/api/v1/ticket/:msisdn` | Melihat tiket gangguan pelanggan |

Parameter `cell` pada endpoint status jaringan dicocokkan dengan nilai kolom
`location` pada data network cell. Gunakan salah satu parameter, `cell` atau
`msisdn`, dalam satu request.

## Kode AI dan API Node.js

Logika AI berada di [`src/ai/`](src/ai/):

- `agentService.js` mengatur alur percakapan, pemanggilan model, dan penggunaan
  tool.
- `qwenClient.js` mengirim permintaan ke endpoint model AI yang kompatibel
  dengan OpenAI.
- `systemPrompt.js` berisi instruksi dan batasan respons asisten.
- `toolDefinitions.js` mendefinisikan tool yang dapat dipilih model.
- `toolExecutor.js` menjalankan tool, seperti mengambil profil, diagnosa,
  informasi tiket, dan pembelian.
- `sessionStore.js` menyimpan state percakapan sementara di memori.
- `usageLogger.js` mencatat penggunaan model.

Alur request dimulai di `src/app.js`. Endpoint chat didefinisikan di
`src/routes/agent.route.js` dan memanggil `runAgent()` dari
`src/ai/agentService.js`. Route API lainnya didefinisikan di `src/routes/`,
logika endpoint ada di `src/controllers/`, dan integrasi layanan ada di
`src/services/`.
Terdapat juga file `controllers/diagnoseController.js` untuk membantu diagnosis dari profile/ quota/ FUP/ network, yang dibuat menggunakan bantuan AI.

Model AI menentukan balasan dan tool yang relevan; data faktual seperti profil,
kuota, dan tiket diambil melalui tool dari layanan/database dummy. Asisten
diinstruksikan untuk tidak mengarang data dan meminta konfirmasi eksplisit
sebelum transaksi. Pada endpoint chat saat ini, `conversationId` dikembalikan
sebagai identitas request, tetapi riwayat percakapan tidak disimpan oleh route
dan dikirim sebagai riwayat kosong pada setiap request.
