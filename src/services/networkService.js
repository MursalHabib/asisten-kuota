// services/networkService.js
const db = require("../../database");

const dbGet = (sql, params) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) =>
      err ? reject(err) : resolve(row ?? null),
    ),
  );

module.exports = {
  getNetworkByMsisdn: (msisdn) =>
    dbGet("SELECT * FROM network_cells WHERE msisdn = ?", [msisdn]),
};
