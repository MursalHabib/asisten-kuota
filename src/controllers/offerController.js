// mock-server/controllers/offerController.js
const db = require("../../database");
const { maskingHandler } = require("../middleware/maskingHandler");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OFFERS = [
  {
    offerId: "OFR-2GB",
    name: "Kuota Tambahan 2 GB",
    quotaMb: 2048,
    validityDays: 1,
    price: 10000,
  },
  {
    offerId: "OFR-5GB",
    name: "Kuota Tambahan 5 GB",
    quotaMb: 5120,
    validityDays: 3,
    price: 20000,
  },
  {
    offerId: "OFR-15GB",
    name: "Combo 15 GB",
    quotaMb: 15360,
    validityDays: 30,
    price: 75000,
  },
];

const OFFER_LOAN = {
  offerId: "LOAN-1GB",
  name: "Paket Darurat 1 GB",
  quotaMb: 1024,
  validityDays: 1,
};
const getCustomer = (msisdn) =>
  new Promise((res, rej) =>
    db.get(
      "SELECT msisdn, subscriber_type, balance FROM customers WHERE msisdn = ?",
      [msisdn],
      (e, r) => (e ? rej(e) : res(r)),
    ),
  );

module.exports = {
  OFFERS,
  browseOffers: async (req, res) => {
    if (!req.query.msisdn)
      return res.status(400).json({ error: "MSISDN_REQUIRED" });
    await sleep(200 + Math.random() * 600);
    res.json({ offers: OFFERS });
  },

  loanEligibility: async (req, res) => {
    const { msisdn } = req.body ?? {};
    if (!msisdn) return res.status(400).json({ error: "MSISDN_REQUIRED" });
    await sleep(200 + Math.random() * 600);

    const cust = await getCustomer(msisdn);
    if (!cust) return res.status(404).json({ error: "SUBSCRIBER_NOT_FOUND" });

    // Aturan dummy: hanya prabayar dengan pulsa < Rp5.000 yang eligible
    const eligible =
      String(cust.subscriber_type).toUpperCase() === "PREPAID" &&
      cust.balance < 5000;
    console.log("[mock-loan]", maskingHandler(msisdn), "eligible", eligible);

    res.json(
      eligible
        ? { eligible: true, limit: 10000, fee: 1000, offer: OFFER_LOAN }
        : { eligible: false, reason: "NOT_ELIGIBLE" },
    );
  },
};
