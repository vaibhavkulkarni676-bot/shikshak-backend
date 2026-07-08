require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { statements, getUsageThisMonth, getPlanLimit } = require('./db');
const { generateText } = require('./ai-provider');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');

// If JWT_SECRET isn't set, generate one for this process so the server still
// runs locally. Set JWT_SECRET in your .env for production so sessions
// survive server restarts.
if(!process.env.JWT_SECRET){
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET not set — using a temporary one for this run. ' +
    'Set JWT_SECRET in your .env so logins survive a server restart.');
}

if(!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY){
  console.warn('⚠️  Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set. ' +
    '/api/generate will fail until at least one is added to your .env file.');
}

const app = express();
const PORT = process.env.PORT || 3000;

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
app.post('/api/auth/signup', authLimiter, (req, res) => {
  const { name, email, password, school } = req.body || {};

  if(!name || !email || !password){
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if(password.length < 6){
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = statements.findUserByEmail.get(email.toLowerCase().trim());
  if(existing){
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = hashPassword(password);
  const result = statements.insertUser.run(name.trim(), email.toLowerCase().trim(), passwordHash, school || null);
  const token = signToken(result.lastInsertRowid);

  res.json({
    token,
    user: { id: result.lastInsertRowid, name, email, school: school || null, plan: 'free' }
  });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password){
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = statements.findUserByEmail.get(email.toLowerCase().trim());
  if(!user || !verifyPassword(password, user.password_hash)){
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken(user.id);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, school: user.school, plan: user.plan, defaultGrade: user.default_grade }
  });
});

// ---------------- ACCOUNT ----------------
app.get('/api/me', requireAuth, (req, res) => {
  const user = statements.findUserById.get(req.userId);
  if(!user) return res.status(404).json({ error: 'User not found.' });

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    school: user.school,
    plan: user.plan,
    defaultGrade: user.default_grade,
    usageThisMonth: getUsageThisMonth(user.id),
    planLimit: getPlanLimit(user.plan) === Infinity ? null : getPlanLimit(user.plan)
  });
});

app.put('/api/me', requireAuth, (req, res) => {
  const { name, school, defaultGrade } = req.body || {};
  const current = statements.findUserById.get(req.userId);
  if(!current) return res.status(404).json({ error: 'User not found.' });

  statements.updateUserProfile.run(
    name?.trim() || current.name,
    school !== undefined ? school : current.school,
    defaultGrade !== undefined ? defaultGrade : current.default_grade,
    req.userId
  );
  res.json({ ok: true });
});

// Mock upgrade — wire this to Razorpay/Stripe webhooks in production so the
// plan only changes after a real successful payment.
app.post('/api/upgrade', requireAuth, (req, res) => {
  const { plan } = req.body || {};
  if(!['free', 'personal', 'school'].includes(plan)){
    return res.status(400).json({ error: 'Invalid plan.' });
  }
  statements.updateUserPlan.run(plan, req.userId);
  res.json({ ok: true, plan });
});

// ---------------- HISTORY ----------------
app.get('/api/history', requireAuth, (req, res) => {
  const rows = statements.getHistory.all(req.userId);
  res.json({ history: rows });
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

  const user = statements.findUserById.get(req.userId);
  if(!user) return res.status(404).json({ error: 'User not found.' });

  const limit = getPlanLimit(user.plan);
  const used = getUsageThisMonth(user.id);
  if(used >= limit){
    return res.status(402).json({
      error: `Free plan limit reached (${limit}/month). Upgrade for unlimited generations.`,
      code: 'LIMIT_REACHED'
    });
  }

  try{
    const result = await generateText({
      provider: provider === 'gemini' ? 'gemini' : 'anthropic',
      system,
      prompt,
      maxTokens: Math.min(Number(max_tokens) || 1000, 2000)
    });

    statements.insertGeneration.run(user.id, tool || 'unknown', (title || '').slice(0, 120), result.provider);

    res.json({
      text: result.text,
      provider: result.provider,
      usageThisMonth: getUsageThisMonth(user.id),
      planLimit: limit === Infinity ? null : limit
    });
  }catch(err){
    console.error('Generation error:', err.message);
    res.status(502).json({ error: 'The AI provider request failed. Check your API keys in .env.' });
  }
});

app.listen(PORT, () => {
  console.log(`Shikshak.ai backend running on port ${PORT}`);
  console.log(`Database file: ${require('path').join(__dirname, 'shikshak.db')}`);
});
