const mongon = require('@bootloader/mongon');

const CompanySchema = mongon.Schema({
  company_id: {
    type: String,
    required: true,
    unique: true
  },
  company_name: {
    type: String,
    required: true
  },
  channels: [{
    channel_id: {
      type: String,
      required: true
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
  }]
}, {
  collection: "Company"
});

// Remove any existing indexes
CompanySchema.indexes().forEach((index) => {
  if (index[0]["apps.app_id"]) {
    CompanySchema.index({ "apps.app_id": 1 }, { unique: false });
  }
});

// module.exports = mongon.model(CompanySchema);
module.exports = CompanySchema;
