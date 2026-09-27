const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.header('Authorization');
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.header('x-auth-token')) {
    token = req.header('x-auth-token');
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'No authentication token provided. Authorization denied.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tripledger_super_secret_jwt_key_2026_safe_hash');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Token is invalid or expired.' });
  }
};

module.exports = auth;
