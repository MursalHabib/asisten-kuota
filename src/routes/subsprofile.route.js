const router = require("express").Router();
const {
  subsProfile,
  createCustomer,
  subsQuota,
  createQuota,
  deleteQuota,
} = require("../controllers/subsprofileController");

router.get("/v1/subscriber/:msisdn/profile", subsProfile);
router.post("/v1/subscriber", createCustomer);

router.get("/v1/subscriber/:msisdn/quota", subsQuota);
router.post("/v1/quota", createQuota);
router.post("/v1/quota/:msisdn", deleteQuota);

module.exports = router;
