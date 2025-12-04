const { Schema, model, Types } = require('mongoose');

const eventSchema = new Schema(
  {
    shop: { type: Types.ObjectId, ref: 'Shop', index: true, required: true },
    topic: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

eventSchema.index({ shop: 1, topic: 1, receivedAt: -1 });

module.exports = model('Event', eventSchema);
