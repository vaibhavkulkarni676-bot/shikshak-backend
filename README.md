# Shikshak.ai Backend

A complete backend for Shikshak.ai: real user accounts, a real database,
login sessions, usage limits enforced server-side, and support for **both**
Claude and Gemini as the AI provider.

This is genuinely everything except two secrets that only you can generate
(your API keys — they're tied to your personal billing accounts, so there's
no way for anyone else to create them for you).

---

## What's inside

| File | What it does |
|---|---|
| `server.js` | The Express app — all API routes |
| `db.js` | SQLite database setup (users, generations) |
| `auth.js` | Password hashing + login sessions (JWT) |
| `ai-provider.js` | Calls Claude or Gemini depending on what you configure |
| `.env.example` | Template for your secrets |

## 1. Install

```bash
cd shikshak-backend
npm install
```

## 2. Add your API keys (the only manual step)

```bash
cp .env.example .env
```

Open `.env` and fill in **at least one** of these:

- **`ANTHROPIC_API_KEY`** — from [console.anthropic.com](https://console.anthropic.com). Go to Settings → API Keys → Create Key. You'll need to add a payment method under Billing first — the key itself is free to create, but usage is billed per token.
- **`GEMINI_API_KEY`** — from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Click "Create API key." Gemini has a genuinely free tier to start, no card required.

You can set both — the frontend will let a teacher's request specify which provider to use, and the backend automatically falls back to whichever one you've actually configured.

Also set `JWT_SECRET` to a random string (or just leave it — the server will generate a temporary one and warn you in the console).

## 3. Run it

```bash
npm start
```

You should see:
```
Shikshak.ai backend running on port 3000
Database file: /path/to/shikshak-backend/shikshak.db
```

That `shikshak.db` file **is your database** — a real SQLite file, created automatically on first run. Every signup, login, and generation is stored in it permanently (as long as the file isn't deleted).

Test it's alive:
```bash
curl http://localhost:3000/
# {"status":"ok","service":"shikshak-ai-backend"}
```

## 4. Point your frontend at it

In the Shikshak.ai frontend file, the API calls need to go to your backend's URL instead of directly to Anthropic. See "Connecting the frontend" below.

---

## API reference

All `/api/*` routes except `/api/auth/*` require a header:
`Authorization: Bearer <token>` (the token you get back from signup/login).

| Method | Route | Body | What it does |
|---|---|---|---|
| POST | `/api/auth/signup` | `{name, email, password, school?}` | Creates an account, returns a token |
| POST | `/api/auth/login` | `{email, password}` | Returns a token |
| GET | `/api/me` | — | Current user + usage this month |
| PUT | `/api/me` | `{name?, school?, defaultGrade?}` | Update profile |
| POST | `/api/upgrade` | `{plan: "personal"\|"school"\|"free"}` | Change plan (wire to real payments before launch — see below) |
| GET | `/api/history` | — | Last 50 generations for this user |
| POST | `/api/generate` | `{prompt, system?, tool?, title?, provider?, max_tokens?}` | Calls the AI, enforces plan limits, logs the generation |

`provider` in `/api/generate` is `"anthropic"` (default) or `"gemini"`.

---

## Deploying so it's live on the internet

Locally running is great for testing, but for real users you need to host
this somewhere. Two easy free/cheap options:

### Option A — Render.com (recommended, simplest)
1. Push this `shikshak-backend` folder to a GitHub repo.
2. On [render.com](https://render.com): New → Web Service → connect your repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Under Environment, add `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGINS` (your real frontend URL, not `*`).
5. **Important for the database:** Render's filesystem resets on redeploy. Add a free "Persistent Disk" (Render dashboard → your service → Disks) mounted at `/opt/render/project/src`, so `shikshak.db` survives redeploys.

### Option B — Railway.app
Same idea — connect repo, set the same environment variables, add a volume for the SQLite file so it persists.

### When you outgrow SQLite
SQLite comfortably handles a real launch (thousands of teachers). If you
later need multiple backend servers running at once, migrate to Postgres —
Railway and Render both offer a free Postgres add-on, and `db.js` is the
only file that would need to change.

---

## Connecting the frontend

The frontend currently calls `https://api.anthropic.com/v1/messages`
directly with no auth — that only works inside the Claude.ai preview sandbox.
Once this backend is deployed, replace that with calls to your backend's
`/api/generate`, sending the `Authorization: Bearer` token from login.
I can wire this up for you directly in the frontend file — just ask.

## Billing (Free / Personal / School plans)

`/api/upgrade` currently changes a user's plan with no payment check — it's
a placeholder so you can test the limit logic. Before charging real money,
add Razorpay (best for India): their webhook should call `/api/upgrade`
only after a successful payment confirmation, not before.
