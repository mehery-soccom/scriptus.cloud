const mongon = require("@bootloader/mongon");

const eventSchema = mongon.Schema(
  {
    user_id: { type: String, required: true },
    event_name: { type: String, required: true },
    attributes: { type: Map, of: String }, // Stores attributes as a key-value map
    timestamp: { type: Date, default: Date.now },
  },
  {
    collection: "EVENT",
  }
);

// module.exports = mongon.model(eventSchema);
module.exports = eventSchema;
