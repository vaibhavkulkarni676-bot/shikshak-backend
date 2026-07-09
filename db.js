const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'shikshak-data.json');

function loadData(){
  if(fs.existsSync(DATA_FILE)){
    try{
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }catch(err){
      console.error('Could not parse shikshak-data.json, starting fresh:', err.message);
    }
  }
  return { users: [], generations: [], nextUserId: 1, nextGenId: 1 };
}

let data = loadData();

function save(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- Plan limits ----
const PLAN_LIMITS = {
  free: 5,
  personal: Infinity,
  school: Infinity
};

// ---- Query-like helpers (same shape as before: .get/.run/.all) so the ----
// ---- rest of the app (server.js) didn't need to change at all.        ----
const statements = {
  insertUser: {
    run(name, email, password_hash, school){
      const user = {
        id: data.nextUserId++,
        name, email, password_hash,
        school: school || null,
        plan: 'free',
        default_grade: null,
        created_at: new Date().toISOString()
      };
      data.users.push(user);
      save();
      return { lastInsertRowid: user.id };
    }
  },

  findUserByEmail: {
    get(email){
      return data.users.find(u => u.email === email);
    }
  },

  findUserById: {
    get(id){
      return data.users.find(u => u.id === id);
    }
  },

  updateUserProfile: {
    run(name, school, default_grade, id){
      const u = data.users.find(u => u.id === id);
      if(u){
        u.name = name;
        u.school = school;
        u.default_grade = default_grade;
        save();
      }
    }
  },

  updateUserPlan: {
    run(plan, id){
      const u = data.users.find(u => u.id === id);
      if(u){
        u.plan = plan;
        save();
      }
    }
  },

  insertGeneration: {
    run(user_id, tool, title, provider){
      const gen = {
        id: data.nextGenId++,
        user_id, tool, title, provider,
        created_at: new Date().toISOString()
      };
      data.generations.push(gen);
      save();
      return { lastInsertRowid: gen.id };
    }
  },

  countGenerationsThisMonth: {
    get(user_id){
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const count = data.generations.filter(g =>
        g.user_id === user_id && new Date(g.created_at) >= startOfMonth
      ).length;
      return { count };
    }
  },

  getHistory: {
    all(user_id){
      return data.generations
        .filter(g => g.user_id === user_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 50)
        .map(g => ({ tool: g.tool, title: g.title, provider: g.provider, created_at: g.created_at }));
    }
  }
};

function getUsageThisMonth(userId){
  return statements.countGenerationsThisMonth.get(userId).count;
}

function getPlanLimit(plan){
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

module.exports = { statements, getUsageThisMonth, getPlanLimit, PLAN_LIMITS };
