const { Schema, model, Types } = require('mongoose');

const variantSchema = new Schema(
  {
    shopifyId: String,
    title: String,
    sku: String,
    price: Number,
    inventoryQuantity: Number,
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    shop: { type: Types.ObjectId, ref: 'Shop', index: true, required: true },
    shopifyId: { type: String, required: true },
    title: String,
    status: String,
    productType: String,
    vendor: String,
    tags: [String],
    variants: [variantSchema],
    shopifyCreatedAt: Date,
    shopifyUpdatedAt: Date,
  },
  { timestamps: true }
);

productSchema.index({ shop: 1, shopifyId: 1 }, { unique: true });

module.exports = model('Product', productSchema);
