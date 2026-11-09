// clients/purchaseClient.js
const BASE_URL = process.env.MOCK_API_BASE_URL ?? "http://localhost:3001";
const TIMEOUT_MS = Number(process.env.PURCHASE_TIMEOUT_MS ?? 3000);
const MAX_RETRY = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (m) => `${String(m).slice(0, 4)}****${String(m).slice(-3)}`;

async function purchaseOffer({ msisdn, offerId, idempotencyKey, traceId }) {
  let lastError = "UNKNOWN";

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/v1/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey, // key SAMA di setiap retry
          ...(traceId ? { "X-Trace-Id": traceId } : {}),
        },
        body: JSON.stringify({ msisdn, offerId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      console.log("[purchase]", {
        traceId,
        attempt,
        status: res.status,
        ms: Date.now() - started,
        msisdn: mask(msisdn),
        offerId,
      });

      if (res.status === 200 || res.status === 201) {
        return {
          success: true,
          replayed: res.headers.get("Idempotent-Replayed") === "true",
          data: await res.json(),
        };
      }
      if (res.status === 402)
        return { success: false, errorCode: "INSUFFICIENT_BALANCE" };
      if (res.status === 409) {
        // masih PROCESSING → tunggu lalu cek lagi
        lastError = "PURCHASE_IN_PROGRESS";
      } else if (res.status < 500) {
        return { success: false, errorCode: `PURCHASE_HTTP_${res.status}` };
      } else {
        lastError = `PURCHASE_HTTP_${res.status}`;
      }
    } catch (e) {
      lastError =
        e.name === "TimeoutError"
          ? "PURCHASE_TIMEOUT"
          : "PURCHASE_NETWORK_ERROR";
      console.warn("[purchase]", {
        traceId,
        attempt,
        error: lastError,
        msisdn: mask(msisdn),
      });
    }
    if (attempt < MAX_RETRY) await sleep(500 * 2 ** attempt);
  }
  // Status akhir tidak pasti → jangan minta user beli ulang dengan key baru
  return { success: false, errorCode: lastError, uncertain: true };
}

module.exports = { purchaseOffer };
