const { maskingHandler } = require("../middleware/maskingHandler");
const db = require("../../database");
const {
  createNetworkTicket,
  findOpenTicket,
} = require("../services/ticketService");

module.exports = {
  createNetworkTicket: async (req, res, next) => {
    try {
      const { ticketNo, status, slaDueAt, isNew } = await createNetworkTicket(
        req.body,
      );
      res.status(201).json({ ticketNo, status, slaDueAt, isNew });
    } catch (error) {
      next(error);
    }
  },
  getNetworkTicket: async (req, res, next) => {
    try {
      const row = await findOpenTicket(req.params.msisdn);
      if (!row) return res.status(404).json({ error: "Ticket not found" });
      res.json({ ...row, msisdn: maskingHandler(row.msisdn) });
    } catch (error) {
      next(error);
    }
  },
};
