const router = require("express").Router();
// const {
//   browseOffers,
// } = require("../controllers/offerController");

router.get("/v1/offers", browseOffers);

module.exports = router;
