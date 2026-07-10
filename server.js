require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { initSchema, statements, getUsageThisMonth, getPlanLimit } = require('./db');
const { generateText } = require('./ai-provider');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');

// If JWT_SECRET isn't set, generate one for this process so the server still
// runs locally. Set JWT_SECRET in your .env / Render environment variables
// so logins survive a server restart.
if(!process.env.JWT_SECRET){
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET not set — using a temporary one for this run. ' +
    'Set JWT_SECRET in your environment so logins survive a server restart.');
}

if(!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY){
  console.warn('⚠️  Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set. ' +
    '/api/generate will fail until at least one is added to your environment variables.');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const allowedOrigins = (process.env.FRONTEND_ORIGINS || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

const generalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_HOUR || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please try again in a few minutes.' }
});

// ---------------- Health check ----------------
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'shikshak-ai-backend' });
});

// ---------------- AUTH ----------------
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try{
    const { name, email, password, school } = req.body || {};

    if(!name || !email || !password){
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if(!EMAIL_RE.test(email)){
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if(password.length < 6){
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await statements.findUserByEmail(normalizedEmail);
    if(existing){
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = hashPassword(password);
    const userId = await statements.insertUser(name.trim(), normalizedEmail, passwordHash, school || null);
    const token = signToken(userId);

    res.json({
      token,
      user: { id: userId, name, email: normalizedEmail, school: school || null, plan: 'free' }
    });
  }catch(err){
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Could not create account. Check server logs / DATABASE_URL.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try{
    const { email, password } = req.body || {};
    if(!email || !password){
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await statements.findUserByEmail(email.toLowerCase().trim());
    if(!user || !verifyPassword(password, user.password_hash)){
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, school: user.school, plan: user.plan, defaultGrade: user.default_grade }
    });
  }catch(err){
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not sign in. Check server logs / DATABASE_URL.' });
  }
});

// ---------------- ACCOUNT ----------------
app.get('/api/me', requireAuth, async (req, res) => {
  try{
    const user = await statements.findUserById(req.userId);
    if(!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      school: user.school,
      plan: user.plan,
      defaultGrade: user.default_grade,
      usageThisMonth: await getUsageThisMonth(user.id),
      planLimit: getPlanLimit(user.plan) === Infinity ? null : getPlanLimit(user.plan)
    });
  }catch(err){
    console.error('Get /api/me error:', err);
    res.status(500).json({ error: 'Could not load account.' });
  }
});

app.put('/api/me', requireAuth, async (req, res) => {
  try{
    const { name, school, defaultGrade } = req.body || {};
    const current = await statements.findUserById(req.userId);
    if(!current) return res.status(404).json({ error: 'User not found.' });

    await statements.updateUserProfile(
      name?.trim() || current.name,
      school !== undefined ? school : current.school,
      defaultGrade !== undefined ? defaultGrade : current.default_grade,
      req.userId
    );
    res.json({ ok: true });
  }catch(err){
    console.error('Update /api/me error:', err);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

// Mock upgrade — wire this to Razorpay/Stripe webhooks in production so the
// plan only changes after a real successful payment.
app.post('/api/upgrade', requireAuth, async (req, res) => {
  try{
    const { plan } = req.body || {};
    if(!['free', 'personal', 'school'].includes(plan)){
      return res.status(400).json({ error: 'Invalid plan.' });
    }
    await statements.updateUserPlan(plan, req.userId);
    res.json({ ok: true, plan });
  }catch(err){
    console.error('Upgrade error:', err);
    res.status(500).json({ error: 'Could not update plan.' });
  }
});

// ---------------- HISTORY ----------------
app.get('/api/history', requireAuth, async (req, res) => {
  try{
    const rows = await statements.getHistory(req.userId);
    res.json({ history: rows });
  }catch(err){
    console.error('History error:', err);
    res.status(500).json({ error: 'Could not load history.' });
  }
});

// ---------------- GENERATE ----------------
app.post('/api/generate', requireAuth, async (req, res) => {
  const { system, prompt, tool, title, provider, max_tokens } = req.body || {};

  if(!prompt || typeof prompt !== 'string'){
    return res.status(400).json({ error: 'Missing "prompt" in request body.' });
  }
  if(prompt.length > 8000){
    return res.status(400).json({ error: 'Prompt too long.' });
  }

  try{
    const user = await statements.findUserById(req.userId);
    if(!user) return res.status(404).json({ error: 'User not found. Please sign out and sign in again.' });

    const limit = getPlanLimit(user.plan);
    const used = await getUsageThisMonth(user.id);
    if(used >= limit){
      return res.status(402).json({
        error: `Free plan limit reached (${limit}/month). Upgrade for unlimited generations.`,
        code: 'LIMIT_REACHED'
      });
    }

    const result = await generateText({
      provider: provider === 'gemini' ? 'gemini' : 'anthropic',
      system,
      prompt,
      maxTokens: Math.min(Number(max_tokens) || 1000, 2000)
    });

    await statements.insertGeneration(user.id, tool || 'unknown', (title || '').slice(0, 120), result.provider);

    res.json({
      text: result.text,
      provider: result.provider,
      usageThisMonth: await getUsageThisMonth(user.id),
      planLimit: limit === Infinity ? null : limit
    });
  }catch(err){
    console.error('Generation error:', err);
    res.status(502).json({ error: err.message || 'The AI provider request failed. Check your API keys.' });
  }
});

async function start(){
  try{
    await initSchema();
  }catch(err){
    console.error('Could not initialize database schema:', err.message);
    console.error('Check that DATABASE_URL is set correctly in your environment variables.');
  }

  app.listen(PORT, () => {
    console.log(`Shikshak.ai backend running on port ${PORT}`);
    console.log(process.env.DATABASE_URL ? 'Connected to Postgres.' : 'WARNING: no DATABASE_URL set.');
  });
}

start();
