const db = require("../../database");

const tableReady = new Promise((resolve, reject) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS conversation_ratings (
      prompt_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('purchase', 'ticket', 'handoff')),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    (error) => (error ? reject(error) : resolve()),
  );
});

const dbRun = (sql, params) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve(this);
    }),
  );

const dbGet = (sql, params) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) =>
      error ? reject(error) : resolve(row ?? null),
    ),
  );

async function saveConversationRating({
  promptId,
  conversationId,
  reason,
  rating,
}) {
  await tableReady;
  const result = await dbRun(
    `INSERT OR IGNORE INTO conversation_ratings
      (prompt_id, conversation_id, reason, rating)
     VALUES (?, ?, ?, ?)`,
    [promptId, conversationId, reason, rating],
  );
  const existing = await dbGet(
    `SELECT conversation_id, reason, rating
     FROM conversation_ratings WHERE prompt_id = ?`,
    [promptId],
  );
  if (
    !existing ||
    existing.conversation_id !== conversationId ||
    existing.reason !== reason ||
    existing.rating !== rating
  ) {
    const error = new Error(
      "Rating prompt tidak cocok dengan kiriman sebelumnya",
    );
    error.status = 409;
    throw error;
  }
  return { saved: true, alreadySubmitted: result.changes === 0 };
}

module.exports = { saveConversationRating };
