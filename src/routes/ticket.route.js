const router = require("express").Router();
const {
  createNetworkTicket,
  getNetworkTicket,
} = require("../controllers/ticketController");

router.post("/v1/ticket", createNetworkTicket);
router.get("/v1/ticket/:msisdn", getNetworkTicket);

module.exports = router;
