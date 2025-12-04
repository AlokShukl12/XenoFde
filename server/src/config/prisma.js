const { PrismaClient } = require('@prisma/client');

// Prisma requires MONGO_URI at runtime; fall back to local dev URI to mirror Mongoose.
if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://localhost:27017/xeno-shopify';
}

let prisma;

// Reuse a single Prisma instance across the app to avoid connection churn.
const getPrisma = () => {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
};

module.exports = getPrisma();
