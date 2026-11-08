// services/subscriberService.js
const db = require("../../database");

const dbGet = (sql, params) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) =>
      err ? reject(err) : resolve(row ?? null),
    ),
  );

module.exports = {
  getProfileByMsisdn: (msisdn) =>
    dbGet("SELECT * FROM customers WHERE msisdn = ?", [msisdn]),

  getQuotaByMsisdn: (msisdn) =>
    dbGet("SELECT * FROM quotas WHERE msisdn = ?", [msisdn]),

  // Opsional: status jaringan per lokasi (lihat bagian 5)
  getNetworkByLocation: async (location) => {
    if (!location) return null;
    try {
      return await dbGet("SELECT * FROM network_status WHERE location = ?", [
        location,
      ]);
    } catch (e) {
      if (/no such table/i.test(e.message)) return null; // tabel belum dibuat
      throw e;
    }
  },
};
