function maskingHandler(msisdn) {
	if (msisdn === null || msisdn === undefined) {
		return msisdn;
	}

	const value = String(msisdn);

	if (value.length <= 8) {
		return '*'.repeat(value.length);
	}

	const prefix = value.slice(0, 4);
	const suffix = value.slice(-4);
	const maskedLength = value.length - 8;

	return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

module.exports = {
	maskingHandler,
};
