const mongon = require('@bootloader/mongon');

const platformSchema = mongon.Schema(
  {
    platform_id: { type: String, required: true, unique: true },
    platform_type: { type: String, required: true, enum: ["ios", "android", "huawei"] },
    bundle_id: { type: String, required: true },
    key_id: { type: String }, // Optional, only for iOS
    team_id: { type: String }, // Optional, only for iOS
    file_path: { type: String }, // Path to platform-specific file
  },
  {
    collection: "Company",
  }
);

const companySchema = mongon.Schema({
  company_name: { type: String, required: true },
  company_id: { type: String, required: true, unique: true },
  app_id: { type: String, required: false }, // Make app_id optional and not unique
  platforms: [platformSchema],
});

// Remove any existing indexes
companySchema.indexes().forEach((index) => {
  if (index[0]["apps.app_id"]) {
    companySchema.index({ "apps.app_id": 1 }, { unique: false });
  }
});

// module.exports = mongon.model(companySchema);
module.exports = companySchema;
