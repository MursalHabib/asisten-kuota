const { qwenClient } = require("./qwenClient.js");
const { SYSTEM_PROMPT } = require("./systemPrompt.js");
const { toolDefinitions } = require("./toolDefinitions.js");
const {
  executeTool,
  normalizeMsisdn,
  maskMsisdn,
} = require("./toolExecutor.js");

const MAX_AGENT_STEPS = Number(process.env.MAX_AGENT_STEPS ?? 6);
const DEBUG = process.env.AGENT_DEBUG === "true";

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

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: buildUserMessage(userMessage) },
    ];

    const toolCache = new Map(); // cegah call berulang dengan args sama
    const toolTrace = [];

    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const isLastStep = step === MAX_AGENT_STEPS - 1;

      let response;
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
        };
      }

      const raw = response?.message ?? {};
      let toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
      if (toolCalls.length === 0) toolCalls = extractTextToolCalls(raw.content);

      log(`step ${step + 1} tool_calls:`, JSON.stringify(toolCalls));

      // Tidak ada tool call → jawaban final
      if (toolCalls.length === 0) {
        return {
          reply:
            stripToolCallText(raw.content) ||
            "Maaf, saya belum dapat memberikan jawaban.",
          steps: step + 1,
          toolTrace,
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
          if (
            name === "start_diagnose" &&
            toolResult.success &&
            toolResult.renderedMessage
          ) {
            messages.push({
              role: "assistant",
              content: toolResult.renderedMessage,
            }); // untuk history
            return {
              reply: toolResult.renderedMessage,
              steps: step + 1,
              toolTrace,
              diagnosis: toolResult.data ?? null,
              messages, // opsional: simpan sebagai history giliran berikutnya
            };
          }

          if (TICKET_INTENT.test(userMessage ?? "")) {
            const r = await executeTool("get_ticket_info", {
              msisdn: sessionMsisdn,
            });

            const t = r.data;
            const reply = r.found
              ? `🎫 Tiket gangguan Anda: ${t.ticketId}\nStatus: ${t.status}\nEstimasi pemulihan sekitar ${t.slaDueAt} jam sejak laporan dibuat.`
              : "Saat ini belum ada tiket gangguan atas nomor Anda. Jika internet bermasalah, saya bisa bantu cek terlebih dahulu.";
            const nextHistory = [
              ...history,
              { role: "user", content: userMessage },
              { role: "assistant", content: reply },
            ];
            return {
              reply,
              steps: 0,
              toolTrace: [
                { tool: "get_ticket_info", success: r.success, found: r.found },
              ],
              history: nextHistory,
            };
          }

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
    };
  },
};
