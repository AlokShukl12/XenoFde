const { Schema, model, Types } = require('mongoose');

const lineItemSchema = new Schema(
  {
    shopifyId: String,
    productId: String,
    variantId: String,
    name: String,
    quantity: Number,
    price: Number,
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    shop: { type: Types.ObjectId, ref: 'Shop', index: true, required: true },
    shopifyId: { type: String, required: true },
    name: String,
    email: String,
    currency: String,
    totalPrice: Number,
    subtotalPrice: Number,
    totalDiscounts: Number,
    financialStatus: String,
    fulfillmentStatus: String,
    processedAt: Date,
    tags: [String],
    customer: {
      id: String,
      email: String,
      firstName: String,
      lastName: String,
    },
    lineItems: [lineItemSchema],
    shopifyCreatedAt: Date,
    shopifyUpdatedAt: Date,
  },
  { timestamps: true }
);

orderSchema.index({ shop: 1, shopifyId: 1 }, { unique: true });
orderSchema.index({ shop: 1, processedAt: -1 });

module.exports = model('Order', orderSchema);
