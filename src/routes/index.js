const router = require("express").Router();

router.use(require("./subsprofile.route"));
router.use(require("./network.route"));
router.use(require("./ticket.route"));
module.exports = router;
