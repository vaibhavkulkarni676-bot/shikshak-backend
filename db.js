const { Pool } = require('pg');

if(!process.env.DATABASE_URL){
  console.warn('⚠️  DATABASE_URL is not set. Signup/login/history will fail until you ' +
    'add a Supabase (or other Postgres) connection string to your environment variables.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Supabase's hosted Postgres
});

async function initSchema(){
  if(!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      school TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      default_grade TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS generations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tool TEXT NOT NULL,
      title TEXT,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at);`);
  console.log('Database schema ready.');
}

// ---- Plan limits ----
const PLAN_LIMITS = {
  free: 5,
  personal: Infinity,
  school: Infinity
};

// ---- Query helpers (all async — Postgres queries are asynchronous) ----
const statements = {
  async insertUser(name, email, password_hash, school){
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, school) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, email, password_hash, school]
    );
    return result.rows[0].id;
  },

  async findUserByEmail(email){
    const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return result.rows[0];
  },

  async findUserById(id){
    const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return result.rows[0];
  },

  async updateUserProfile(name, school, default_grade, id){
    await pool.query(
      `UPDATE users SET name = $1, school = $2, default_grade = $3 WHERE id = $4`,
      [name, school, default_grade, id]
    );
  },

  async updateUserPlan(plan, id){
    await pool.query(`UPDATE users SET plan = $1 WHERE id = $2`, [plan, id]);
  },

  async insertGeneration(user_id, tool, title, provider){
    await pool.query(
      `INSERT INTO generations (user_id, tool, title, provider) VALUES ($1, $2, $3, $4)`,
      [user_id, tool, title, provider]
    );
  },

  async countGenerationsThisMonth(user_id){
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM generations WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
      [user_id]
    );
    return result.rows[0].count;
  },

  async getHistory(user_id){
    const result = await pool.query(
      `SELECT tool, title, provider, created_at FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [user_id]
    );
    return result.rows;
  }
};

async function getUsageThisMonth(userId){
  return await statements.countGenerationsThisMonth(userId);
}

function getPlanLimit(plan){
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

module.exports = { pool, initSchema, statements, getUsageThisMonth, getPlanLimit, PLAN_LIMITS };
