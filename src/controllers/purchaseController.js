// mock-server/controllers/purchaseController.js
const db = require("../../database");
const { maskingHandler } = require("../middleware/maskingHandler");
const { OFFERS } = require("./offerController"); // export OFFERS dari offerController

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOW_RATE = Number(process.env.MOCK_PURCHASE_SLOW_RATE ?? 0); // simulasi timeout, mis. 0.3

const dbGet = (sql, p) =>
  new Promise((res, rej) =>
    db.get(sql, p, (e, r) => (e ? rej(e) : res(r ?? null))),
  );
const dbRun = (sql, p) =>
  new Promise((res, rej) =>
    db.run(sql, p, function (e) {
      return e ? rej(e) : res(this);
    }),
  );

const toResponse = (row) => ({
  trxId: row.trx_id,
  status: row.status,
  offerId: row.offer_id,
  price: row.price,
  createdAt: row.created_at,
});

module.exports = {
  purchase: async (req, res) => {
    const key = req.get("Idempotency-Key");
    const { msisdn, offerId } = req.body ?? {};
    if (!key)
      return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });
    if (!msisdn || !offerId)
      return res.status(422).json({ error: "VALIDATION_ERROR" });

    const offer = OFFERS.find((o) => o.offerId === offerId);
    if (!offer) return res.status(404).json({ error: "OFFER_NOT_FOUND" });

    // 1) Klaim key. Kalau sudah ada → replay, jangan proses ulang
    try {
      await dbRun(
        `INSERT INTO purchases (idempotency_key, msisdn, offer_id, price, status) VALUES (?, ?, ?, ?, 'PROCESSING')`,
        [key, msisdn, offerId, offer.price],
      );
    } catch (e) {
      if (!/UNIQUE/i.test(e.message)) throw e;
      const prev = await dbGet(
        "SELECT * FROM purchases WHERE idempotency_key = ?",
        [key],
      );
      if (prev.msisdn !== msisdn || prev.offer_id !== offerId) {
        return res.status(409).json({ error: "IDEMPOTENCY_KEY_CONFLICT" });
      }
      if (prev.status === "PROCESSING")
        return res.status(409).json({ error: "PURCHASE_IN_PROGRESS" });
      if (prev.status === "FAILED")
        return res.status(402).json({ error: "INSUFFICIENT_BALANCE" });
      console.log(
        "[mock-purchase] replay",
        prev.trx_id,
        maskingHandler(msisdn),
      );
      return res
        .status(200)
        .set("Idempotent-Replayed", "true")
        .json(toResponse(prev));
    }

    // 2) Simulasi latency / lambat (agar client timeout lalu retry)
    await sleep(Math.random() < SLOW_RATE ? 5000 : 200 + Math.random() * 600);

    // 3) Potong pulsa secara atomik (hanya jika cukup)
    const upd = await dbRun(
      "UPDATE customers SET balance = balance - ? WHERE msisdn = ? AND balance >= ?",
      [offer.price, msisdn, offer.price],
    );
    if (upd.changes === 0) {
      await dbRun(
        `UPDATE purchases SET status = 'FAILED' WHERE idempotency_key = ?`,
        [key],
      );
      return res.status(402).json({ error: "INSUFFICIENT_BALANCE" });
    }

    const trxId = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await dbRun(
      `UPDATE purchases SET status = 'SUCCESS', trx_id = ? WHERE idempotency_key = ?`,
      [trxId, key],
    );
    const row = await dbGet(
      "SELECT * FROM purchases WHERE idempotency_key = ?",
      [key],
    );

    console.log(
      "[mock-purchase] success",
      trxId,
      maskingHandler(msisdn),
      offerId,
    );
    return res.status(201).json(toResponse(row));
  },
};
