const router = require("express").Router();
const {
  browseOffers,
  loanEligibility,
} = require("../controllers/offerController");

const { purchase } = require("../controllers/purchaseController");

router.get("/v1/offers", browseOffers);
router.post("/v1/loan/eligibility", loanEligibility);

router.post("/v1/purchase", purchase);

module.exports = router;
