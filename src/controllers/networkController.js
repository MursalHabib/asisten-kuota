const { maskingHandler } = require("../middleware/maskingHandler");
const db = require("../../database");
const { getNetworkByMsisdn } = require("../services/networkService");

module.exports = {
  networkProfile: async (req, res, next) => {
    const { msisdn } = req.query;
    try {
      const row = await getNetworkByMsisdn(req.query.msisdn);
      if (!row)
        return res.status(404).json({ error: "Network status not found" });

      res.json({ ...row, msisdn: maskingHandler(row.msisdn) });
    } catch (error) {
      next(error);
    }
  },
  addNetworkStatus: async (req, res, next) => {
    const now = new Date();
    const { msisdn, location, status, active_incident } = req.body;

    try {
      db.run(
        `INSERT INTO network_cells (msisdn,
    location,
    status,
    active_incident,
    last_checked) VALUES (?, ?, ?, ?, ?)`,
        [msisdn, location, status, active_incident, now],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json({
            message: "Network cell created successfully",
            networkCellId: this.lastID,
          });
        },
      );
    } catch (error) {
      next(error);
    }
  },
};
