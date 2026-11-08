// services/ticketService.js
const db = require("../../database");

const DEDUP_HOURS = Number(process.env.TICKET_DEDUP_HOURS ?? 24);
const SLA_HOURS = { HIGH: 4, MEDIUM: 24 };

const dbGet = (sql, p) =>
  new Promise((res, rej) =>
    db.get(sql, p, (e, r) => (e ? rej(e) : res(r ?? null))),
  );
const dbRun = (sql, p) =>
  new Promise((res, rej) =>
    db.run(sql, p, function (e) {
      return e ? rej(e) : res(this);
    }),
  );

function buildTicketNo(id) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `INC-${ymd}-${String(id).padStart(5, "0")}`;
}

// async function findOpenTicket(msisdn, location) {
//   return dbGet(
//     `SELECT * FROM tickets
//      WHERE msisdn = ? AND IFNULL(location,'') = IFNULL(?, '')
//        AND status IN ('OPEN','IN_PROGRESS')
//        AND created_at >= datetime('now','localtime', ?)
//      ORDER BY id DESC LIMIT 1`,
//     [msisdn, location, `-${DEDUP_HOURS} hours`],
//   );
// }

async function findOpenTicket(msisdn) {
  return dbGet(
    `SELECT ticket_no, status, severity, sla_due_at, created_at
     FROM tickets
     WHERE msisdn = ?
       AND status IN ('OPEN','IN_PROGRESS')
     ORDER BY id DESC LIMIT 1`,
    [msisdn],
  );
}

/**
 * Buat ticket gangguan jaringan (idempotent).
 *
 */
// @returns {{ ticketNo, status, slaDueAt, isNew }}

async function createNetworkTicket({
  msisdn,
  location,
  networkStatus,
  snapshot,
}) {
  const existing = await findOpenTicket(msisdn, location);
  if (existing) {
    return {
      ticketNo: existing.ticket_no,
      status: existing.status,
      slaDueAt: existing.sla_due_at,
      isNew: false,
    };
  }

  const severity = networkStatus === "DOWN" ? "HIGH" : "MEDIUM";
  const category = networkStatus === "DOWN" ? "DOWN" : "DEGRADED";

  const run = await dbRun(
    `INSERT INTO tickets (msisdn, location, category, severity, status, description, diagnose_snapshot, sla_due_at)
     VALUES (?, ?, ?, ?, 'OPEN', ?, ?, datetime('now','localtime', ?))`,
    [
      msisdn,
      location,
      category,
      severity,
      `Pelanggan mengeluhkan koneksi lambat. Status jaringan lokasi: ${networkStatus}.`,
      JSON.stringify(snapshot ?? {}),
      `+${SLA_HOURS[severity]} hours`,
    ],
  );

  const ticketNo = buildTicketNo(run.lastID);
  await dbRun("UPDATE tickets SET ticket_no = ? WHERE id = ?", [
    ticketNo,
    run.lastID,
  ]);

  const row = await dbGet("SELECT sla_due_at FROM tickets WHERE id = ?", [
    run.lastID,
  ]);
  return { ticketNo, status: "OPEN", slaDueAt: row?.sla_due_at, isNew: true };
}

module.exports = { createNetworkTicket, findOpenTicket };
