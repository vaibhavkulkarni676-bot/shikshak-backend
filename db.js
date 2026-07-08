const Database = require('better-sqlite3');
const path = require('path');

// SQLite file lives right next to this file. On most hosts (Render, Railway)
// you should mount a persistent disk at this path so data survives restarts —
// see README.md for exact instructions.
const db = new Database(path.join(__dirname, 'shikshak.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    school TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    default_grade TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tool TEXT NOT NULL,
    title TEXT,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id);
  CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at);
`);

// ---- Plan limits ----
const PLAN_LIMITS = {
  free: 5,
  personal: Infinity,
  school: Infinity
};

// ---- Query helpers ----
const statements = {
  insertUser: db.prepare(`INSERT INTO users (name, email, password_hash, school) VALUES (?, ?, ?, ?)`),
  findUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  findUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUserProfile: db.prepare(`UPDATE users SET name = ?, school = ?, default_grade = ? WHERE id = ?`),
  updateUserPlan: db.prepare(`UPDATE users SET plan = ? WHERE id = ?`),

  insertGeneration: db.prepare(`INSERT INTO generations (user_id, tool, title, provider) VALUES (?, ?, ?, ?)`),
  countGenerationsThisMonth: db.prepare(`
    SELECT COUNT(*) as count FROM generations
    WHERE user_id = ? AND created_at >= datetime('now', 'start of month')
  `),
  getHistory: db.prepare(`
    SELECT tool, title, provider, created_at FROM generations
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `)
};

function getUsageThisMonth(userId){
  return statements.countGenerationsThisMonth.get(userId).count;
}

function getPlanLimit(plan){
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

module.exports = { db, statements, getUsageThisMonth, getPlanLimit, PLAN_LIMITS };
