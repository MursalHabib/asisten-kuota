const { maskingHandler } = require("../middleware/maskingHandler");
const db = require("../../database");
const {
  getProfileByMsisdn,
  getQuotaByMsisdn,
} = require("../services/subscriberService");

module.exports = {
  createCustomer: async (req, res, next) => {
    const {
      msisdn,
      segment,
      subscriber_type,
      consent_personalization,
      consent_transaction,
      timestamp,
      location,
    } = req.body;

    try {
      db.run(
        `INSERT INTO customers (msisdn, segment, subscriber_type, consent_personalization, consent_transaction, timestamp, location) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          msisdn,
          segment,
          subscriber_type,
          consent_personalization,
          consent_transaction,
          timestamp,
          location,
        ],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json({
            message: "Customer created successfully",
            customerId: this.lastID,
          });
        },
      );
    } catch (error) {
      next(error);
    }
  },
  subsProfile: async (req, res, next) => {
    try {
      const row = await getProfileByMsisdn(req.params.msisdn);
      if (!row) return res.status(404).json({ error: "Customer not found" });
      res.json({ ...row, msisdn: maskingHandler(row.msisdn) });
    } catch (error) {
      next(error);
    }
  },
  createQuota: async (req, res, next) => {
    const {
      msisdn,
      total_quota_mb,
      remaining_quota_mb,
      remaining_percent,
      fup_status,
      fup_threshold_mb,
      valid_until,
      diagnostic_code,
    } = req.body;

    try {
      db.run(
        `INSERT INTO quotas (msisdn, total_quota_mb, remaining_quota_mb, remaining_percent, fup_status, fup_threshold_mb, valid_until, diagnostic_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msisdn,
          total_quota_mb,
          remaining_quota_mb,
          remaining_percent,
          fup_status,
          fup_threshold_mb,
          valid_until,
          diagnostic_code,
        ],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json({
            message: "Quota created successfully",
            quotaId: this.lastID,
          });
        },
      );
    } catch (error) {
      next(error);
    }
  },
  subsQuota: async (req, res, next) => {
    try {
      const row = await getQuotaByMsisdn(req.params.msisdn);
      if (!row) return res.status(404).json({ error: "Quota not found" });
      res.json({ ...row, msisdn: maskingHandler(row.msisdn) });
    } catch (error) {
      next(error);
    }
  },
  deleteQuota: async (req, res, next) => {
    try {
      db.run("DELETE FROM quotas WHERE msisdn = ?", [req.params.msisdn]);
      res.json({ message: "Quota deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
};
