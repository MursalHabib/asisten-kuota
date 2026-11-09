const { qwenClient } = require("./qwenClient.js");
const { SYSTEM_PROMPT } = require("./systemPrompt.js");
const { toolDefinitions } = require("./toolDefinitions.js");
const {
  executeTool,
  normalizeMsisdn,
  maskMsisdn,
} = require("./toolExecutor.js");
const crypto = require("crypto");
const sessionStore = require("./sessionStore.js");
const { fmtIdr, logUsage } = require("./usageLogger");
const MAX_AGENT_STEPS = Number(process.env.MAX_AGENT_STEPS ?? 6);
const DEBUG = process.env.AGENT_DEBUG === "true";
const QWEN_MODEL =
  process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3.5:latest";
// Tool yang MSISDN-nya selalu diambil dari sesi (bukan dari LLM)
const SESSION_BOUND_TOOLS = new Set([
  "get_customer_profile",
  "start_diagnose",
  "get_ticket_info",
]);

const TICKET_INTENT =
  /\b(tiket|ticket|nomor laporan|no\.? laporan|status (laporan|gangguan))\b/i;

const log = (...a) => DEBUG && console.log("[agent]", ...a);

// ---------- Helpers ----------
function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return { ...raw }; // Ollama native: object
  try {
    // OpenAI-compatible: string
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function userGaveConsent(userMessage, consent) {
  const text = String(userMessage ?? "").toUpperCase();
  if (consent === "KONFIRMASI")
    return /\b(KONFIRMASI|YA|LANJUT|SETUJU|OK)\b/.test(text);
  if (consent === "BATAL")
    return /\b(BATAL|TIDAK|GAK|ENGGAK|CANCEL)\b/.test(text);
  return false;
}

// Fallback: Qwen kadang menulis tool call di content sebagai <tool_call>{...}</tool_call>
function extractTextToolCalls(content = "") {
  const calls = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj?.name) {
        calls.push({
          function: { name: obj.name, arguments: obj.arguments ?? {} },
        });
      }
    } catch {
      /* abaikan */
    }
  }
  return calls;
}

function stripToolCallText(content = "") {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

function buildUserMessage(userMessage) {
  return [
    "Konteks sesi:",
    "- Pelanggan SUDAH terautentikasi. Nomor pelanggan sudah diketahui sistem.",
    "- Jangan meminta nomor HP; gunakan tool untuk mengambil data akun.",
    "",
    "Pesan pelanggan:",
    userMessage,
  ].join("\n");
}

// ---------- Main ----------
module.exports = {
  runAgent: async ({ userMessage, msisdn, history = [] }) => {
    const sessionMsisdn = normalizeMsisdn(msisdn);
    if (!sessionMsisdn) {
      console.error(
        "[agent] msisdn sesi kosong — cek route/controller pemanggil runAgent",
      );
      return {
        reply: "Maaf, sesi pelanggan tidak ditemukan. Silakan login ulang.",
        steps: 0,
        error: "MISSING_MSISDN",
      };
    }
    log("start", { msisdn: maskMsisdn(sessionMsisdn), userMessage });

    // ================= ROUTER DETERMINISTIK (sebelum LLM) =================
    const text = String(userMessage ?? "")
      .trim()
      .toUpperCase();
    const s = sessionStore.get(sessionMsisdn);
    const rupiah = (n) => `Rp${Number(n ?? 0).toLocaleString("id-ID")}`;

    const done = (reply, trace, extra = {}) => ({
      reply,
      steps: 0,
      toolTrace: [trace],
      history: [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: reply },
      ],
      ...extra,
    });
    const clearOffer = () =>
      sessionStore.set(sessionMsisdn, {
        pendingAction: null,
        selectedOffer: null,
        idempotencyKey: null,
        loanOffer: null,
      });

    // 1) BATAL saat sedang memilih/konfirmasi paket atau Paket Darurat
    if (
      ["SELECT_OFFER", "CONFIRM_PURCHASE", "CONFIRM_LOAN"].includes(
        s.pendingAction,
      ) &&
      text === "BATAL"
    ) {
      clearOffer();
      return done("Baik, dibatalkan. Ada lagi yang bisa saya bantu?", {
        step: "cancel",
      });
    }

    // 2) Pilih paket → buat Idempotency-Key sekali per permintaan
    if (s.pendingAction === "SELECT_OFFER" && /^\d$/.test(text)) {
      const offer = s.lastOffers?.[Number(text) - 1];
      if (!offer) {
        return done(
          `Pilihan tidak tersedia. Balas angka 1–${s.lastOffers?.length ?? 0}, atau BATAL.`,
          { step: "select_offer", success: false, errorCode: "INVALID_CHOICE" },
        );
      }
      sessionStore.set(sessionMsisdn, {
        selectedOffer: offer,
        idempotencyKey: crypto.randomUUID(),
        pendingAction: "CONFIRM_PURCHASE",
      });
      return done(
        `Anda akan membeli ${offer.name} seharga ${rupiah(offer.price)} dari pulsa.\nBalas KONFIRMASI untuk membeli, atau BATAL.`,
        { step: "select_offer", success: true, offerId: offer.offerId },
      );
    }

    // 3) KONFIRMASI beli (KONFIRMASI ulang setelah sukses → replay idempoten)
    if (
      ["CONFIRM_PURCHASE", "PURCHASED"].includes(s.pendingAction) &&
      text === "KONFIRMASI"
    ) {
      const offer = s.selectedOffer;
      const r = await executeTool(
        "purchase_offer",
        {
          msisdn: sessionMsisdn,
          offerId: offer.offerId,
          idempotencyKey: s.idempotencyKey,
        },
        { internal: true },
      );
      const trace = {
        tool: "purchase_offer",
        offerId: offer.offerId,
        success: r.success,
        replayed: r.replayed,
        errorCode: r.errorCode,
      };

      if (r.success) {
        sessionStore.set(sessionMsisdn, { pendingAction: "PURCHASED" });
        return done(
          r.replayed
            ? "Anda baru saja membeli paket ini."
            : "Terima kasih, permintaan akan diproses.",
          trace,
        );
      }
      if (r.errorCode === "INSUFFICIENT_BALANCE") {
        clearOffer();
        return done(
          "Maaf, pulsa Anda tidak cukup untuk membeli paket ini. Silakan isi pulsa terlebih dahulu.",
          trace,
        );
      }
      if (r.uncertain) {
        return done(
          "Pembelian sedang kami pastikan. Balas KONFIRMASI beberapa saat lagi untuk cek status. Pulsa tidak akan terpotong dua kali.",
          trace,
        );
      }
      return done(
        "Maaf, pembelian belum berhasil. Saya hubungkan Anda dengan agen kami.",
        trace,
        { handoffRecommended: true },
      );
    }

    // 4) KONFIRMASI Paket Darurat
    if (s.pendingAction === "CONFIRM_LOAN" && text === "KONFIRMASI") {
      const loan = s.loanOffer;
      clearOffer();
      // Kontrak mock hanya punya /loan/eligibility → aktivasi disimulasikan
      return done(
        `Terima kasih, ${loan?.offer?.name ?? "Paket Darurat"} akan diproses. Biaya layanan ${rupiah(loan?.fee)} dibayar saat isi pulsa berikutnya.`,
        { step: "activate_loan", success: true, offerId: loan?.offer?.offerId },
      );
    }

    // 5) Tanya tiket (DIPINDAH dari dalam loop tool)
    if (TICKET_INTENT.test(userMessage ?? "")) {
      const r = await executeTool("get_ticket_info", { msisdn: sessionMsisdn });
      const t = r.data;
      const eta = t?.slaDueAt
        ? `Estimasi penanganan: ${t.slaDueAt}.`
        : t?.etaHours
          ? `Estimasi pemulihan sekitar ${t.etaHours} jam.`
          : "";
      const reply = !r.success
        ? "Maaf, pengecekan tiket belum berhasil. Saya hubungkan Anda dengan agen kami."
        : r.found
          ? `🎫 Tiket gangguan Anda: ${t.ticketId}\nStatus: ${t.status}\n${eta}`.trim()
          : "Saat ini belum ada tiket gangguan atas nomor Anda. Jika internet bermasalah, saya bisa bantu cek terlebih dahulu.";
      return done(
        reply,
        {
          tool: "get_ticket_info",
          success: r.success,
          found: r.found,
          source: r.source,
        },
        { handoffRecommended: !r.success },
      );
    }
    // ================= END ROUTER =================

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: buildUserMessage(userMessage) },
    ];

    const toolCache = new Map(); // cegah call berulang dengan args sama
    const toolTrace = [];
    const usageTrace = [];
    const conversationId = maskMsisdn(sessionMsisdn);
    const usageOut = () => ({
      usage: {
        calls: usageTrace.map(({ cost_idr, cost_usd, ...u }) => ({ ...u })),
        total_tokens: usageTrace.reduce((a, u) => a + u.total_tokens, 0),
        total_cost: fmtIdr(usageTrace.reduce((a, u) => a + u.cost_idr, 0)),
      },
    });
    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const isLastStep = step === MAX_AGENT_STEPS - 1;

      let response;
      const llmStart = Date.now();
      try {
        response = await qwenClient({
          messages,
          // Step terakhir: tanpa tools → paksa model menjawab
          ...(isLastStep ? {} : { tools: toolDefinitions }),
          temperature: 0.1,
        });
      } catch (error) {
        console.error("[agent] LLM error:", error);
        return {
          reply:
            "Maaf, layanan asisten sedang tidak tersedia. Silakan coba lagi.",
          steps: step + 1,
          error: "LLM_ERROR",
          ...usageOut(),
        };
      }
      const latencyMs = Date.now() - llmStart;

      const raw = response?.message ?? {};
      let toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
      if (toolCalls.length === 0) toolCalls = extractTextToolCalls(raw.content);

      const usageRow = logUsage({
        conversationId,
        step: step + 1,
        model: QWEN_MODEL,
        usage: response?.usage, // <- bukan usageInfo
        latencyMs,
        tools: toolCalls.map((tc) => tc?.function?.name).filter(Boolean),
      });
      if (usageRow) usageTrace.push(usageRow);

      log(`step ${step + 1} tool_calls:`, JSON.stringify(toolCalls));

      // Tidak ada tool call → jawaban final
      if (toolCalls.length === 0) {
        return {
          reply:
            stripToolCallText(raw.content) ||
            "Maaf, saya belum dapat memberikan jawaban.",
          steps: step + 1,
          toolTrace,
          ...usageOut(),
        };
      }

      // Simpan assistant message dalam format bersih
      messages.push({
        role: "assistant",
        content: stripToolCallText(raw.content ?? ""),
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const args = parseArgs(toolCall?.function?.arguments);

        if (SESSION_BOUND_TOOLS.has(name)) args.msisdn = sessionMsisdn;
        let toolResult;
        if (name === "start_diagnose") {
          args.consent = String(args.consent ?? "").toUpperCase();
          if (!userGaveConsent(userMessage, args.consent)) {
            toolResult = {
              success: false,
              errorCode: "CONSENT_NOT_GIVEN",
              message:
                "Pelanggan belum memberi jawaban eksplisit. Tanyakan: balas KONFIRMASI atau BATAL.",
            };
            messages.push({
              role: "tool",
              tool_name: name,
              content: JSON.stringify(toolResult),
            });
            continue;
          }
        }

        const cacheKey = `${name}:${JSON.stringify(args)}`;

        if (toolCache.has(cacheKey)) {
          toolResult = {
            ...toolCache.get(cacheKey),
            note: "Hasil ini sudah diambil sebelumnya. Gunakan untuk menjawab, jangan panggil tool lagi.",
          };
        } else {
          const started = Date.now();
          toolResult = await executeTool(name, args);

          toolCache.set(cacheKey, toolResult);
          toolTrace.push({
            tool: name,
            success: toolResult.success,
            errorCode: toolResult.errorCode,
            ms: Date.now() - started,
          });
        }

        log(`tool ${name} →`, JSON.stringify(toolResult).slice(0, 500));

        messages.push({
          role: "tool",

          tool_name: name, // format native Ollama
          ...(toolCall.id ? { tool_call_id: toolCall.id } : {}), // format OpenAI-compatible
          content: JSON.stringify(toolResult),
        });
      }
    }

    return {
      reply:
        "Maaf, proses pengecekan terlalu panjang. Silakan coba kembali atau hubungi agent.",
      steps: MAX_AGENT_STEPS,
      handoffRecommended: true,
      toolTrace,
      ...usageOut(),
    };
  },
};
