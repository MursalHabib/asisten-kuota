const { getProfileByMsisdn } = require("../services/subscriberService");
const {
  startDiagnose,
  getQuota,
} = require("../controllers/diagnoseController");
const { findOpenTicket } = require("../services/ticketService");
const sessionStore = require("./sessionStore");

const API_GET_TICKET = "http://localhost:3001/api/v1/ticket/";

const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS ?? 15000);
const MSISDN_REGEX = /^62\d{8,13}$/;
const SENSITIVE_KEYS = new Set(["nik", "pin", "otp", "password", "puk", "kk"]);
const invalidMsisdn = {
  success: false,
  errorCode: "INVALID_MSISDN",
  message: "Format nomor tidak valid",
};
const ALLOWED_TOOLS = new Set([
  "get_customer_profile",
  "get_customer_quota",
  "start_diagnose",
  "get_ticket_info",
]);
const VALID_CONSENT = new Set(["KONFIRMASI", "BATAL"]);
function normalizeMsisdn(value) {
  let s = String(value ?? "").replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  else if (s.startsWith("8")) s = "62" + s;
  return s;
}

function maskMsisdn(m) {
  const s = String(m ?? "");
  return s.length > 7 ? `${s.slice(0, 4)}****${s.slice(-3)}` : "****";
}

// Masking MSISDN dan buang field sensitif sebelum dikirim ke LLM
function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (SENSITIVE_KEYS.has(key)) continue;
      out[k] = key.includes("msisdn") ? maskMsisdn(v) : sanitize(v);
    }
    return out;
  }
  return obj;
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new ToolError("TIMEOUT", `Tool timeout ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const handlers = {
  async get_customer_profile(args) {
    const msisdn = normalizeMsisdn(args.msisdn);
    if (!MSISDN_REGEX.test(msisdn)) return invalidMsisdn;

    const row = await withTimeout(getProfileByMsisdn(msisdn), TOOL_TIMEOUT_MS);
    if (!row)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Profil pelanggan tidak ditemukan",
      };
    return { success: true, data: sanitize(row) };
  },

  async get_customer_quota(args) {
    const msisdn = normalizeMsisdn(args.msisdn);
    if (!MSISDN_REGEX.test(msisdn)) return invalidMsisdn;

    const quota = await withTimeout(getQuota(msisdn), TOOL_TIMEOUT_MS);
    if (!quota)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Data kuota tidak ditemukan",
      };
    return { success: true, data: quota };
  },

  async get_ticket_info(args) {
    const msisdn = normalizeMsisdn(args.msisdn);
    if (!MSISDN_REGEX.test(msisdn)) return invalidMsisdn;

    let row;

    const { lastTicket } = sessionStore.get(msisdn);
    if (!lastTicket) {
      try {
        const data = await withTimeout(
          fetch(API_GET_TICKET + msisdn),
          TOOL_TIMEOUT_MS,
        );
        console.log(data);
        if (data?.status == 404)
          return { success: true, found: false, source: "db" };
        if (data.ok) {
          row = await data.json();
          const ticket = {
            ticketId: row.ticket_no,
            status: row.status,
            slaDueAt: row.sla_due_at,
            createdAt: row.created_at,
          };
          console.log(ticket);
          sessionStore.set(msisdn, { lastTicket: ticket });
          return { success: true, found: true, source: "db", data: ticket };
        }
      } catch (e) {
        console.error(
          "[toolExecutor] findOpenTicket gagal:",
          e.message,
          "msisdn",
          maskMsisdn(msisdn),
        );
        return {
          success: false,
          errorCode: "TICKET_LOOKUP_FAILED",
          handoff: true,
        };
      }
    }
    if (lastTicket)
      return {
        success: true,
        found: true,
        source: "session",
        data: lastTicket,
      };
  },

  async start_diagnose(args) {
    const msisdn = normalizeMsisdn(args.msisdn);
    const consent = String(args.consent ?? "")
      .trim()
      .toUpperCase();

    if (!MSISDN_REGEX.test(msisdn)) return invalidMsisdn;
    if (!VALID_CONSENT.has(consent)) {
      return {
        success: false,
        errorCode: "INVALID_CONSENT",
        message: "Consent harus KONFIRMASI atau BATAL",
      };
    }
    if (consent === "BATAL") {
      return {
        success: true,
        status: "CANCELLED",
        renderedMessage:
          "Baik, pengecekan dibatalkan. Ada lagi yang bisa saya bantu?",
      };
    }

    const result = await withTimeout(startDiagnose(msisdn), TOOL_TIMEOUT_MS);
    if (result.ticket?.success) {
      sessionStore.set(msisdn, {
        lastTicket: {
          ticketId: result.ticket.ticketId,
          status: result.ticket.status,
          etaHours: result.ticket.etaHours,
          createdAt: new Date().toISOString(),
        },
      });
    }
    return {
      success: true,
      status: "COMPLETED",
      data: sanitize({
        quota: result.quota,
        network: result.network,
        analysis: result.analysis,
        ticket: result.ticket?.ticketNo
          ? {
              ticketNo: result.ticket.ticketNo,
              status: result.ticket.status,
              slaDueAt: result.ticket.slaDueAt,
            }
          : null,
      }),
      renderedMessage: result.renderedMessage,
    };
  },
};

// ---------- Public API ----------
module.exports = {
  normalizeMsisdn,
  maskMsisdn,

  executeTool: async (toolName, args = {}) => {
    if (!ALLOWED_TOOLS.has(toolName) || !handlers[toolName]) {
      return {
        success: false,
        errorCode: "TOOL_NOT_ALLOWED",
        message: `Tool tidak tersedia: ${toolName}`,
      };
    }
    try {
      return await handlers[toolName](args);
    } catch (error) {
      console.error(`[toolExecutor] ${toolName} gagal:`, error);
      return {
        success: false,
        errorCode: error.code ?? "TOOL_EXECUTION_ERROR",
        message: "Pengecekan belum berhasil dilakukan",
      };
    }
  },
};
