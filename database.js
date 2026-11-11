const sqlite3 = require('sqlite3').verbose();
// const db = new sqlite3.Database(':memory:');
const db = new sqlite3.Database('./database.sqlite', (err) => {
	if (err) {
		console.error('Error opening database:', err.message);
	} else {
		console.log('Connected to the persistent SQLite database.');
	}
});

db.serialize(() => {
	//   db.run(`CREATE TABLE IF NOT EXISTS customers (
	//     msisdn TEXT PRIMARY KEY,
	//     segment TEXT,
	//     subscriber_type TEXT,
	//     consent_personalization BOOLEAN,
	//     consent_transaction BOOLEAN,
	//     timestamp DATETIME,
	//     location TEXT
	//   )`);
	//   db.run(`CREATE TABLE IF NOT EXISTS quotas (
	//   msisdn TEXT PRIMARY KEY,
	//   total_quota_mb INTEGER NOT NULL,
	//   remaining_quota_mb INTEGER NOT NULL,
	//   remaining_percent INTEGER NOT NULL,
	//   fup_status TEXT NOT NULL,
	//   fup_threshold_mb INTEGER NOT NULL,
	//   valid_until TEXT NOT NULL,
	//   diagnostic_code TEXT NOT NULL,
	//   FOREIGN KEY (msisdn) REFERENCES customers(msisdn)
	// )`);
	//   db.run(`CREATE TABLE IF NOT EXISTS network_cells (
	//     msisdn TEXT PRIMARY KEY,
	//     location TEXT,
	//     status TEXT NOT NULL,
	//     active_incident INTEGER NOT NULL,
	//     last_checked DATETIME NOT NULL,
	//     FOREIGN KEY (msisdn) REFERENCES customers(msisdn)
	//   )`);
	//   db.run(`
	//     CREATE TABLE IF NOT EXISTS tickets (
	//   id            INTEGER PRIMARY KEY AUTOINCREMENT,
	//   ticket_no     TEXT UNIQUE,
	//   msisdn        TEXT NOT NULL,
	//   location      TEXT,
	//   category      TEXT NOT NULL,
	//   severity      TEXT NOT NULL,
	//   status        TEXT NOT NULL DEFAULT 'OPEN',
	//   description   TEXT,
	//   diagnose_snapshot TEXT,
	//   created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
	//   sla_due_at    TEXT
	// )`);
	//   db.run(
	//     `CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets (msisdn, location, status)`,
	//   );
	// db.run(`ALTER TABLE customers DROP COLUMN eligible`);
	// db.run(`ALTER TABLE customers ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
	// db.run(`UPDATE customers SET balance = 100000 WHERE msisdn = '628111111101'`);
	//   db.run(`
	//     CREATE TABLE IF NOT EXISTS purchases (
	//   id               INTEGER PRIMARY KEY AUTOINCREMENT,
	//   idempotency_key  TEXT NOT NULL UNIQUE,
	//   msisdn           TEXT NOT NULL,
	//   offer_id         TEXT NOT NULL,
	//   price            INTEGER NOT NULL,
	//   status           TEXT NOT NULL,
	//   trx_id           TEXT,
	//   created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
	// )`);
});

module.exports = db;
