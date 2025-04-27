const mongon = require('@bootloader/mongon');

const ChannelsSchema = mongon.Schema({
    channel_id: {
      type: String,
      required: true,
      unique: true
    },
    channel_name: {
      type: String,
      required: true
    },
    platforms: [{
      platform_id: {
        type: String,
        required: true
      },
      platform_type: {
        type: String,
        enum: ['ios', 'android', 'huawei'],
        required: true
      },
      bundle_id: {
        type: String,
        required: true
      },
      key_id: String,  // Optional, only for iOS
      team_id: String, // Optional, only for iOS
      file_path: {
        type: String,
        required: true
      },
      active: {
        type: Boolean,
        default: true
      }
    }]  
}, {
  collection: "Channels"
});

module.exports = ChannelsSchema; 