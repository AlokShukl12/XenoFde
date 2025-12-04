const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const authMiddleware = (req, res, next) => {
  // Allow Shopify webhooks to bypass user auth.
  if (req.path.startsWith('/webhooks')) {
    return next();
  }

  const email = (req.headers['x-user-email'] || '').toString().trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ message: 'Missing x-user-email header' });
  }

  if (allowedEmails.length && !allowedEmails.includes(email)) {
    return res.status(403).json({ message: 'Email not allowed for onboarding' });
  }

  req.userEmail = email;
  next();
};

module.exports = authMiddleware;
