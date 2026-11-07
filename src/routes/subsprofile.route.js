const router = require('express').Router();
const {
	subsProfile,
	createCustomer,
} = require('../controllers/subsprofileController');
const maskingHandler = require('../middleware/maskingHandler');

router.get('/v1/subscriber/:msisdn/profile', subsProfile);
router.post('/v1/subscriber', createCustomer);

module.exports = router;
