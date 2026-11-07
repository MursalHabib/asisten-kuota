const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite', (err) => {
	if (err) {
		console.error('Error opening database:', err.message);
	} else {
		console.log('Connected to the persistent SQLite database.');
	}
}); // In-memory DB

// Create a simple users table
db.serialize(() => {
	db.run(`CREATE TABLE customers (
    msisdn TEXT PRIMARY KEY,
    segment TEXT,
    subscriber_type TEXT,
    consent_personalization BOOLEAN,
    consent_transaction BOOLEAN,
    timestamp DATETIME,
    location TEXT
  )`);
});

module.exports = db;
