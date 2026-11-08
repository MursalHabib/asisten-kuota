require('dotenv').config();
const { qwenClient } = require('./qwenClient');

async function main() {
  const result = await qwenClient({
    messages: [
      {
        role: 'system',
        content:
          'Kamu adalah asisten yang membantu pengguna untuk mendapatkan informasi tentang kuota internet mereka. Jawab pertanyaan dengan jelas dan ringkas.',
      },
      {
        role: 'user',
        content: 'Tolong cek profil dan status consent saya untuk nomor 628111111101',
      },
    ],
  });

  console.log(result.message?.content ?? '');
}

main().catch((error) => {
  console.error('Gagal menghubungi Qwen:', error);
  process.exitCode = 1;
});