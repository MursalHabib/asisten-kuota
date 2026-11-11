const { maskingHandler } = require("../middleware/maskingHandler");
const db = require("../../database");
const {
  getNetworkByMsisdn,
  getNetworkByCell,
} = require("../services/networkService");

module.exports = {
  networkProfile: async (req, res, next) => {
    const { msisdn, cell } = req.query;
    if (
      (msisdn && typeof msisdn !== "string") ||
      (cell && typeof cell !== "string")
    ) {
      return res
        .status(400)
        .json({ error: "Provide one cell or msisdn query parameter" });
    }
    if (msisdn && cell) {
      return res
        .status(400)
        .json({ error: "Provide either cell or msisdn, not both" });
    }
    if (!msisdn && !cell) {
      return res
        .status(400)
        .json({ error: "Query parameter cell or msisdn is required" });
    }

    try {
      const row = cell
        ? await getNetworkByCell(cell)
        : await getNetworkByMsisdn(msisdn);
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
