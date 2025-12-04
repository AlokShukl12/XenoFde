const { Schema, model } = require('mongoose');

const shopSchema = new Schema(
  {
    name: { type: String },
    ownerEmail: { type: String, index: true },
    shopDomain: { type: String, required: true, unique: true, lowercase: true },
    accessToken: { type: String, required: true },
    apiVersion: { type: String, default: process.env.SHOPIFY_API_VERSION || '2024-10' },
    scopes: [String],
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    lastSyncedAt: { type: Date },
    webhookSharedSecret: { type: String },
    metadata: { type: Map, of: String },
  },
  { timestamps: true }
);

module.exports = model('Shop', shopSchema);
