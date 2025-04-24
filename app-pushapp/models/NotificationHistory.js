const mongon = require('@bootloader/mongon');

const notificationHistorySchema = mongon.Schema({
  notification_id: {
    type: String,
    required: true,
    unique: true
  },
  channel_id: {
    type: String,
    required: true
  },
  company_id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  image_url: String,
  category: String,
  buttons: [{
    button_id: String,
    button_text: String,
    button_url: String
  }],
  sent_to: {
    total: Number,
    ios: { type: Number, default: 0 },
    android: { type: Number, default: 0 },
    huawei: { type: Number, default: 0 }
  },
  opened: {
    total: { type: Number, default: 0 },
    ios: { type: Number, default: 0 },
    android: { type: Number, default: 0 },
    huawei: { type: Number, default: 0 }
  },
  status: {
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  sent_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: "NOTIFICATION_HISTORY"
});

module.exports = notificationHistorySchema; 