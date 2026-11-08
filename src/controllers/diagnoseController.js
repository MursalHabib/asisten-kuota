// services/diagnoseService.js
const {
  getProfileByMsisdn,
  getQuotaByMsisdn,
  getNetworkByLocation,
} = require("../services/subscriberService");
const { getNetworkByMsisdn } = require("../services/networkService");
const { createNetworkTicket } = require("../services/ticketService");

const LOW_QUOTA_PERCENT = Number(process.env.LOW_QUOTA_PERCENT ?? 10);
const LOW_QUOTA_MB = Number(process.env.LOW_QUOTA_MB ?? 500);

// ---------- Mapper: row DB → format internal ----------
function normalizeFup(value) {
  const v = String(value ?? "")
    .trim()
    .toUpperCase();
  if (["FUP", "HIT", "THROTTLED", "ACTIVE", "YES", "TRUE", "1"].includes(v))
    return "FUP";
  return "NORMAL";
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
  const quotaEmpty = quota && quota.remainingMb <= 0;
  const quotaLow =
    quota &&
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

async function getQuota(...candidates) {
  const tried = [
    ...new Set(candidates.filter(Boolean).map((c) => String(c).trim())),
  ];

  for (const msisdn of tried) {
    const row = await getQuotaByMsisdn(msisdn);
    console.log("[diagnose] getQuota", msisdn, "→", row ? "FOUND" : "EMPTY");
    if (row) return mapQuota(row);
  }
  return null;
}

async function handleNetworkTicket({
  msisdn,
  profile,
  network,
  quota,
  analysis,
}) {
  if (!network || network.status === "NORMAL") return null;
  try {
    return await createNetworkTicket({
      msisdn,
      location: profile.location,
      networkStatus: network.status,
      snapshot: { network, quota, cause: analysis.cause },
    });
  } catch (e) {
    console.error("[diagnose] gagal membuat ticket:", e);
    return { error: true }; // jangan karang nomor ticket
  }
}

async function startDiagnose(msisdn) {
  const profile = await getProfileByMsisdn(msisdn);
  const quota = await getQuotaByMsisdn(msisdn);
  const network = await getNetworkByMsisdn(msisdn);
  if (!profile) {
    const err = new Error("Profil tidak ditemukan");
    err.code = "NOT_FOUND";
    throw err;
  }

  const analysis = analyze({ quota, network });
  const ticket = await handleNetworkTicket({
    msisdn,
    profile,
    network,
    quota,
    analysis,
  });

  return {
    profile: {
      segment: profile.segment,
      subscriberType: profile.subscriber_type,
      location: profile.location,
    },
    quota,
    network,
    analysis,
    ticket,
    renderedMessage: render({ quota, network, analysis, ticket }),
  };
}

// ---------- Template ----------
function render({ quota, network, analysis, ticket }) {
  const lines = ["Saya sudah melakukan pengecekan.", ""];

  lines.push("📶 Jaringan");
  lines.push(network ? NETWORK_LABEL[network.status] : "Belum dapat dicek", "");

  lines.push("📊 Kuota internet");
  lines.push(
    quota
      ? `${formatSize(quota.remaining_quota_mb)} tersisa dari ${formatSize(quota.total_quota_mb)}`
      : "Belum dapat dicek",
    "",
  );

  lines.push("⚡ Status FUP");
  lines.push(quota ? FUP_LABEL[quota.fup_status] : "Belum dapat dicek", "");

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
    lines.push("");
    lines.push("🎫 Laporan gangguan");
    lines.push(
      ticket.isNew
        ? `Laporan Anda sudah kami buat dengan nomor ${ticket.ticketNo}.`
        : `Gangguan ini sudah tercatat dengan nomor ${ticket.ticketNo}.`,
    );
    lines.push("Tim kami sedang menangani gangguan di lokasi Anda.");
    if (ticket.slaDueAt) lines.push(`Estimasi penanganan: ${ticket.slaDueAt}.`);
  } else if (ticket?.error) {
    lines.push("");
    lines.push(
      "Laporan gangguan belum berhasil dibuat. Saya bisa hubungkan Anda ke agent kami.",
    );
  }

  return lines.join("\n");
}

module.exports = { startDiagnose, getQuota, analyze, render, formatSize };
