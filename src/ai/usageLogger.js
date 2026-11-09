// usageLogger.js - log token usage + estimasi biaya (USD & Rupiah) per percakapan.
// Tanpa dependency eksternal: simpan ke JSONL + agregasi in-memory.

const fs = require("fs");
const path = require("path");

// Harga per 1 JUta token (USD). Isi sesuai tarif gateway/provider.
const PRICE_INPUT = Number(process.env.PRICE_INPUT_USD_PER_1M ?? 0);
const PRICE_CACHED = Number(
  process.env.PRICE_CACHED_INPUT_USD_PER_1M ?? PRICE_INPUT,
);
const PRICE_OUTPUT = Number(process.env.PRICE_OUTPUT_USD_PER_1M ?? 0);
const USD_IDR = Number(process.env.USD_IDR_RATE ?? 0); // wajib diisi untuk konversi Rupiah
const LOG_FILE =
  process.env.USAGE_LOG_FILE ?? path.join(process.cwd(), "llm_usage.jsonl");

const totals = new Map(); // conversationId -> akumulasi

function calcCost(usage) {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  // cached_tokens adalah BAGIAN dari prompt_tokens, bukan tambahan
  const cached = Math.min(
    usage?.prompt_tokens_details?.cached_tokens ?? 0,
    prompt,
  );
  const uncached = prompt - cached;

  const costUsd =
    (uncached * PRICE_INPUT +
      cached * PRICE_CACHED +
      completion * PRICE_OUTPUT) /
    1_000_000;
  const costIdr = costUsd * USD_IDR;

  return {
    prompt,
    completion,
    cached,
    uncached,
    total: usage?.total_tokens ?? prompt + completion,
    costUsd,
    costIdr,
  };
}

const fmtIdr = (n) =>
  "Rp " +
  n.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function logUsage({
  conversationId = "unknown",
  step = "-",
  model,
  usage,
  latencyMs,
  tools,
}) {
  if (!usage) {
    console.warn(
      `[LLM_USAGE] conv=${conversationId} step=${step} usage tidak ada di response`,
    );
    return null;
  }
  const c = calcCost(usage);

  const row = {
    ts: new Date().toISOString(),
    conversationId,
    step,
    model,
    prompt_tokens: c.prompt,
    cached_tokens: c.cached,
    completion_tokens: c.completion,
    total_tokens: c.total,
    cost_usd: c.costUsd,
    cost_idr: c.costIdr,
    latency_ms: latencyMs ?? null,
  };

  // akumulasi per percakapan
  const t = totals.get(conversationId) ?? {
    calls: 0,
    prompt: 0,
    cached: 0,
    completion: 0,
    usd: 0,
    idr: 0,
  };
  t.calls += 1;
  t.prompt += c.prompt;
  t.cached += c.cached;
  t.completion += c.completion;
  t.usd += c.costUsd;
  t.idr += c.costIdr;
  totals.set(conversationId, t);

  console.log(
    `[LLM_USAGE] conv=${conversationId} step=${step} in=${c.prompt} (cached=${c.cached}) ` +
      `out=${c.completion} total=${c.total} cost=${fmtIdr(c.costIdr)} ` +
      `| akumulasi_conv=${fmtIdr(t.idr)} (${t.calls} call)`,
  );

  fs.appendFile(
    LOG_FILE,
    JSON.stringify(row) + "\n",
    (e) => e && console.error("[LLM_USAGE] gagal tulis log", e.message),
  );
  return row;
}

const getConversationTotal = (id) => totals.get(id) ?? null;

if (!USD_IDR)
  console.warn("[LLM_USAGE] USD_IDR_RATE belum di-set, biaya Rupiah akan 0");

module.exports = { logUsage, calcCost, getConversationTotal, fmtIdr };
