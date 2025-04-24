const mongon = require('@bootloader/mongon');

const ChannelHistorySchema = mongon.Schema({
  channel_id: {
    type: String,
    required: true
  },
  user_id: {
    type: String,
    required: true
  },
  change_type: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  channel_data: {
    type: Object,
    required: true
  }
}, {
  collection: "CHANNEL_HISTORY"
});

module.exports = ChannelHistorySchema;
