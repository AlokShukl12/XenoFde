const { Schema, model, Types } = require('mongoose');

const customerSchema = new Schema(
  {
    shop: { type: Types.ObjectId, ref: 'Shop', index: true, required: true },
    shopifyId: { type: String, required: true },
    email: { type: String, index: true },
    phone: { type: String },
    firstName: String,
    lastName: String,
    tags: [String],
    totalSpent: { type: Number, default: 0 },
    state: String,
    country: String,
    marketingOptInLevel: String,
    shopifyCreatedAt: Date,
    shopifyUpdatedAt: Date,
  },
  { timestamps: true }
);

customerSchema.index({ shop: 1, shopifyId: 1 }, { unique: true });

module.exports = model('Customer', customerSchema);
