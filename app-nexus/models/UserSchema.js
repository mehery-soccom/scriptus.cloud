const mongon = require("@bootloader/mongon");

const Schema = mongon.Schema(
  {
    code: { type: String, alias: "usercode" },
    name: { type: String, alias: "username" },
    email: { type: String, alias: "user_email" },
    isActive: { type: String },
    isEnabled: { type: Boolean },
    isDefaultValue: { type: Boolean },
    isAdmin: Boolean,
  },
  {
    minimize: false,
    collection: "USERS",
  }
);

module.exports = Schema;
