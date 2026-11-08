module.exports = {
  toolDefinitions: [
    {
      type: "function",
      function: {
        name: "start_diagnose",
        description:
          "Menjalankan diagnosa lengkap (profil, kuota, status FUP, jaringan) untuk keluhan internet lambat/jaringan. " +
          "Tawarkan diagnosa dulu, minta pelanggan membalas KONFIRMASI atau BATAL. " +
          "WAJIB dipanggil segera setelah pelanggan menjawab KONFIRMASI atau BATAL. Jangan membalas teks 'mohon tunggu'.",
        parameters: {
          type: "object",
          properties: {
            consent: {
              type: "string",
              enum: ["KONFIRMASI", "BATAL"],
              description:
                "Jawaban pelanggan: KONFIRMASI untuk lanjut, BATAL untuk membatalkan.",
            },
          },
          required: ["consent"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_ticket_info",
        description:
          "Mengambil nomor dan status tiket gangguan milik pelanggan yang sedang login. " +
          "WAJIB dipanggil jika pelanggan bertanya tentang tiket, laporan gangguan, nomor laporan, atau status penanganan.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_customer_profile",
        description:
          "Mengambil profil pelanggan yang sedang login: segmen, jenis subscriber, status consent, lokasi. " +
          "Panggil jika pelanggan bertanya tentang profil, akun, atau consent.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_customer_quota",
        description:
          "Mengambil sisa kuota dan status FUP pelanggan yang sedang login. Panggil jika pelanggan hanya bertanya sisa kuota.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
  ],
};
