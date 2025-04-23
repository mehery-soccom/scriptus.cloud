const mongon = require('@bootloader/mongon');

const deviceTokenSchema = mongon.Schema(
  {
    device_id: { type: String, required: true, unique: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    user_id: { type: String },
    company_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    session_id: { type: String, required: true }, // session ID to track sessions
    last_active: { type: Date, default: Date.now }, // timestamp to track session activity
    status: { type: Boolean, default: true },
  },
  {
    collection: "DEVICE_TOKEN",
  }
);

// module.exports = mongon.model(deviceTokenSchema);
module.exports = deviceTokenSchema;
