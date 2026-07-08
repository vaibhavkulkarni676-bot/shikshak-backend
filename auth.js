const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function hashPassword(password){
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash){
  return bcrypt.compareSync(password, hash);
}

function signToken(userId){
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token){
  try{
    return jwt.verify(token, JWT_SECRET);
  }catch(err){
    return null;
  }
}

// Express middleware: attaches req.userId if a valid token is present,
// otherwise responds 401.
function requireAuth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token){
    return res.status(401).json({ error: 'Not signed in.' });
  }
  const payload = verifyToken(token);
  if(!payload){
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  req.userId = payload.userId;
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth };
