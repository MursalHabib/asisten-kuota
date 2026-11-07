const { maskingHandler } = require('../middleware/maskingHandler');
const db = require('../../database');

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
						message: 'Customer created successfully',
						customerId: this.lastID,
					});
				},
			);
		} catch (error) {
			next(error);
		}
	},
	subsProfile: async (req, res, next) => {
		const { msisdn } = req.params;
		try {
			db.get(
				'SELECT * FROM customers WHERE msisdn = ?',
				[msisdn],
				(err, row) => {
					if (err)
						return res.status(500).json({ error: err.message });
					if (!row)
						return res
							.status(404)
							.json({ error: 'Customer not found' });
					res.json({
						...row,
						msisdn: maskingHandler(row.msisdn),
					});
				},
			);
		} catch (error) {
			next(error);
		}
	},
};
