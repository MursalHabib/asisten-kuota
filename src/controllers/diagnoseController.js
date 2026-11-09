// controllers/diagnoseController.js

const {
  getProfileByMsisdn,
  getQuotaByMsisdn,
} = require("../services/subscriberService");
const { createNetworkTicket } = require("../services/ticketService");
// Pakai HTTP client (bukan Express controller) → integrasi via API
// const {
//   browseOffers,
//   checkLoanEligibility,
// } = require("../clients/offerClient");

const LOW_QUOTA_PERCENT = Number(process.env.LOW_QUOTA_PERCENT ?? 10);
const LOW_QUOTA_MB = Number(process.env.LOW_QUOTA_MB ?? 500);

const API_LOAN_ELIGIBILITY = "http://127.0.0.1:3001/api/v1/loan/eligibility";
const API_BROWSE_OFFERS = "http://127.0.0.1:3001/api/v1/offers?msisdn=";
const API_GET_PROFILE = "http://127.0.0.1:3001/api/v1/subscriber/";
const API_GET_QUOTA = "http://127.0.0.1:3001/api/v1/subscriber/";
const API_GET_NETWORK = "http://127.0.0.1:3001/api/v1/network/status";
const API_POST_TICKET = "http://127.0.0.1:3001/api/v1/ticket";

const maskForLog = (m) => {
  const s = String(m ?? "");
  return s.length > 7 ? `${s.slice(0, 4)}****${s.slice(-3)}` : "****";
};

// ---------- Mapper: row DB/API → format internal ----------
function normalizeFup(value) {
  const v = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    [
      "FUP",
      "REACHED",
      "HIT",
      "THROTTLED",
      "ACTIVE",
      "YES",
      "TRUE",
      "1",
    ].includes(v)
  )
    return "FUP";
  return "NOT_REACHED"; // termasuk NOT_REACHED
}

function mapQuota(row) {
  if (!row) return null;
  const totalMb = Number(row.total_quota_mb ?? 0);
  const remainingMb = Number(row.remaining_quota_mb ?? 0);
  const remainingPercent =
    row.remaining_percent != null
      ? Number(row.remaining_percent)
      : totalMb > 0
        ? (remainingMb / totalMb) * 100
        : 0;
  return {
    totalMb,
    remainingMb,
    remainingPercent,
    fupStatus: normalizeFup(row.fup_status),
    fupThresholdMb: row.fup_threshold_mb ?? null,
    validUntil: row.valid_until ?? null,
    diagnosticCode: row.diagnostic_code ?? null,
  };
}

function mapNetwork(row) {
  if (!row) return null;
  const s = String(row.status ?? "").toUpperCase();
  return { status: ["NORMAL", "DEGRADED", "DOWN"].includes(s) ? s : "NORMAL" };
}

// ---------- Helpers ----------
function formatSize(mb) {
  if (mb == null || Number.isNaN(Number(mb))) return "-";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

const rupiah = (n) => `Rp${Number(n ?? 0).toLocaleString("id-ID")}`;
const isNetworkProblem = (n) => ["DEGRADED", "DOWN"].includes(n?.status);

const NETWORK_LABEL = {
  NORMAL: "Normal",
  DEGRADED: "Terganggu",
  DOWN: "Gangguan",
};
const FUP_LABEL = {
  NOT_REACHED: "Belum terkena FUP",
  FUP: "Sudah terkena FUP",
};

// ---------- Rule engine ----------
function analyze({ quota, network }) {
  const notes = [];
  const quotaEmpty = !!quota && quota.remainingMb <= 0;
  const quotaLow =
    !!quota &&
    !quotaEmpty &&
    (quota.remainingMb <= LOW_QUOTA_MB ||
      quota.remainingPercent <= LOW_QUOTA_PERCENT);
  const fupHit = quota?.fupStatus === "FUP";
  const networkOk = network?.status === "NORMAL";

  if (quotaEmpty) notes.push("Kuota internet Anda sudah habis.");
  else if (quotaLow) notes.push("Kuota Anda hampir habis.");
  if (fupHit) notes.push("Kecepatan internet Anda sedang dibatasi karena FUP.");
  if (network) {
    notes.push(
      networkOk
        ? "Jaringan di lokasi Anda saat ini normal."
        : "Terdapat gangguan jaringan di lokasi Anda saat ini.",
    );
  }

  let cause = null;
  if (network && !networkOk) cause = "gangguan jaringan di lokasi Anda";
  else if (quotaEmpty) cause = "kuota yang sudah habis";
  else if (fupHit) cause = "pembatasan kecepatan (FUP)";
  else if (quotaLow) cause = "kuota yang hampir habis";

  return { cause, notes, flags: { quotaLow, quotaEmpty, fupHit, networkOk } };
}

// ---------- Data fetchers ----------
async function getQuota(...candidates) {
  const tried = [
    ...new Set(candidates.filter(Boolean).map((c) => String(c).trim())),
  ];
  for (const msisdn of tried) {
    const quota = await getQuotaByMsisdn(msisdn);
    // const quota = await fetch(API_GET_QUOTA + `${msisdn}/quota`);
    // const row = await quota.json();
    console.log(
      "[diagnose] getQuota",
      maskForLog(msisdn),
      "→",
      quota ? "FOUND" : "EMPTY",
    );
    if (quota) return mapQuota(quota);
  }
  return null;
}

async function getNetwork(msisdn) {
  const network = await fetch(API_GET_NETWORK + "?msisdn=" + msisdn);
  const row = await network.json();
  if (!row) console.warn("[diagnose] network kosong untuk", maskForLog(msisdn));
  return mapNetwork(row);
}

// ---------- Ticket ----------
async function handleNetworkTicket({
  msisdn,
  profile,
  network,
  quota,
  analysis,
}) {
  if (!isNetworkProblem(network)) return null;
  try {
    const ticket = await fetch(API_POST_TICKET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msisdn,
        location: profile.location,
        networkStatus: network.status,
        snapshot: { network, quota, cause: analysis.cause },
      }),
    }).then((r) =>
      r.json().catch(() => ({ ok: false, errorCode: "INVALID_JSON" })),
    );
    return ticket;
  } catch (e) {
    console.error("[diagnose] gagal membuat ticket:", e.message);
    return { error: true }; // jangan karang nomor ticket
  }
}

// ---------- Rekomendasi paket / Paket Darurat ----------
async function buildRecommendation({ msisdn, profile, analysis, network }) {
  const { quotaLow, quotaEmpty, fupHit } = analysis.flags;
  // Tidak menawarkan paket jika tidak perlu, atau jika penyebabnya gangguan jaringan
  if (!(quotaLow || quotaEmpty || fupHit) || isNetworkProblem(network))
    return null;

  const r = await fetch(API_BROWSE_OFFERS + msisdn);

  console.log("[diagnose] browseOffers →", r.ok ? "OK" : r.errorCode);
  if (!r.ok) return { type: "ERROR", errorCode: r.errorCode };

  const rJson = await r.json();

  const offers = rJson?.offers ?? [];
  if (!offers.length) return { type: "ERROR", errorCode: "NO_OFFERS" };

  const pulsa = Number(profile.balance ?? 0);
  const cheapest = Math.min(...offers.map((o) => Number(o.price)));
  if (pulsa >= cheapest) return { type: "OFFERS", offers, balance: pulsa };

  // Pulsa tidak cukup → cek Paket Darurat
  if (pulsa < cheapest) {
    const loan = await fetch(API_LOAN_ELIGIBILITY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msisdn }),
    }).then((r) =>
      r.json().catch(() => ({ ok: false, errorCode: "INVALID_JSON" })),
    );
    console.log(
      "[diagnose] loanEligibility →",
      loan.eligible ? `eligible=${loan?.eligible}` : loan.errorCode,
    );
    if (loan?.eligible) return { type: "LOAN", loan: loan, balance: pulsa };
    if (loan.ok) return { type: "NO_BALANCE", balance: pulsa };
    return { type: "NO_BALANCE", balance: pulsa, errorCode: loan.errorCode };
  }
}

// ---------- Template ----------
function render({ quota, network, analysis, ticket }) {
  const lines = ["Saya sudah melakukan pengecekan.", ""];

  lines.push("📶 Jaringan");
  lines.push(network ? NETWORK_LABEL[network.status] : "Belum dapat dicek", "");

  lines.push("📊 Kuota internet");
  lines.push(
    quota
      ? `${formatSize(quota.remainingMb)} tersisa dari ${formatSize(quota.totalMb)}`
      : "Belum dapat dicek",
    "",
  );

  lines.push("⚡ Status FUP");
  console.log("isi quota", quota);
  lines.push(quota ? FUP_LABEL[quota.fupStatus] : "Belum dapat dicek", "");

  lines.push(...analysis.notes);

  if (analysis.cause) {
    lines.push(`Kemungkinan koneksi lambat disebabkan ${analysis.cause}.`);
  } else if (quota && network) {
    lines.push("Kami tidak menemukan kendala pada kuota maupun jaringan Anda.");
    lines.push(
      "Jika koneksi masih lambat, saya bisa hubungkan Anda ke agent kami.",
    );
  } else {
    lines.push(
      "Sebagian pengecekan belum berhasil. Silakan coba lagi beberapa saat lagi.",
    );
  }

  // ---- Info ticket ----
  if (ticket?.ticketNo) {
    lines.push("", "🎫 Laporan gangguan");
    lines.push(
      ticket.isNew
        ? `Laporan Anda sudah kami buat dengan nomor ${ticket.ticketNo}.`
        : `Gangguan ini sudah tercatat dengan nomor ${ticket.ticketNo}.`,
    );
    lines.push("Tim kami sedang menangani gangguan di lokasi Anda.");
    if (ticket.slaDueAt) lines.push(`Estimasi penanganan: ${ticket.slaDueAt}.`);
  } else if (ticket?.error) {
    lines.push(
      "",
      "Laporan gangguan belum berhasil dibuat. Saya bisa hubungkan Anda ke agent kami.",
    );
  }

  return lines.join("\n");
}

function renderRecommendation(rec) {
  if (!rec) return "";
  switch (rec.type) {
    case "OFFERS":
      return [
        "",
        "",
        "🎁 Rekomendasi paket",
        ...rec.offers.map(
          (o, i) =>
            `${i + 1}. ${o.name} • ${formatSize(o.quotaMb)} • ${o.validityDays} hari • ${rupiah(o.price)}`,
        ),
        "",
        `Pulsa Anda: ${rupiah(rec.balance)}`,
        `Balas angka 1–${rec.offers.length} untuk memilih, atau BATAL.`,
      ].join("\n");

    case "LOAN": {
      const { offer, fee } = rec.loan;
      return [
        "",
        "",
        `Pulsa Anda (${rupiah(rec.balance)}) belum cukup untuk membeli paket.`,
        "🆘 Anda bisa memakai Paket Darurat:",
        `${offer?.name} • ${formatSize(offer?.quotaMb)} • ${offer?.validityDays} hari`,
        `Biaya layanan ${rupiah(fee)}, dibayar otomatis saat isi pulsa berikutnya.`,
        "",
        "Balas KONFIRMASI untuk mengaktifkan Paket Darurat, atau BATAL.",
      ].join("\n");
    }

    case "NO_BALANCE":
      return `\n\nPulsa Anda (${rupiah(rec.balance)}) belum cukup untuk membeli paket. Silakan isi pulsa terlebih dahulu.`;

    case "ERROR":
      return "\n\nDaftar paket belum bisa ditampilkan saat ini. Silakan coba beberapa saat lagi.";

    default:
      return "";
  }
}

// ---------- Orchestrator ----------
async function startDiagnose(msisdn) {
  // const r = await fetch(API_GET_PROFILE + msisdn + "/profile");
  const profile = await getProfileByMsisdn(msisdn);
  if (!profile) {
    const err = new Error("Profil tidak ditemukan");
    err.code = "NOT_FOUND";
    throw err;
  }
  console.log("isi profil", profile);
  // 2) Kuota & jaringan paralel; kegagalan salah satunya tidak menggagalkan diagnosa
  const [quotaRes, networkRes] = await Promise.allSettled([
    getQuota(profile.msisdn),
    getNetwork(msisdn),
  ]);
  if (quotaRes.status === "rejected")
    console.error("[diagnose] quota gagal:", quotaRes.reason?.message);
  if (networkRes.status === "rejected")
    console.error("[diagnose] network gagal:", networkRes.reason?.message);

  const quota = quotaRes.status === "fulfilled" ? quotaRes.value : null;
  const network = networkRes.status === "fulfilled" ? networkRes.value : null;

  // 3) Analisis → ticket (jika jaringan bermasalah) → rekomendasi (jika kuota/FUP)
  const analysis = analyze({ quota, network });
  const ticket = await handleNetworkTicket({
    msisdn,
    profile,
    network,
    quota,
    analysis,
  });
  const recommendation = await buildRecommendation({
    msisdn,
    profile,
    analysis,
    network,
  });

  return {
    profile: {
      segment: profile.segment,
      subscriberType: profile.subscriber_type,
      location: profile.location,
      pulsa: Number(profile.balance ?? 0),
    },
    quota,
    network,
    analysis,
    ticket,
    recommendation,
    handoffRecommended: !!ticket?.error,
    renderedMessage:
      render({ quota, network, analysis, ticket }) +
      renderRecommendation(recommendation),
  };
}

module.exports = {
  startDiagnose,
  getQuota,
  getNetwork,
  analyze,
  render,
  renderRecommendation,
  formatSize,
};
