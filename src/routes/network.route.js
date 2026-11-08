const router = require("express").Router();
const {
  networkProfile,
  addNetworkStatus,
} = require("../controllers/networkController");

router.get("/v1/network/status", networkProfile);
router.post("/v1/network/status", addNetworkStatus);

module.exports = router;
