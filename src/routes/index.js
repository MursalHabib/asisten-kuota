const router = require("express").Router();

router.use(require("./subsprofile.route"));
router.use(require("./network.route"));
router.use(require("./ticket.route"));
router.use(require("./offers.route"));
module.exports = router;
