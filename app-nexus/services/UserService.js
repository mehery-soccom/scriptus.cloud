const console = require("@bootloader/log4js").getLogger("DemoService");

import mongon from "@bootloader/mongon";
import UserSchema from "../models/UserSchema";

export default {
  async testFunction() {
    console.log("Hello : testFunction");
  },
  async getUser({ userId }) {
    let UserSchemaModel = mongon.model(UserSchema);
    return await UserSchemaModel.findOne({ usercode: userId });
  },
  async getUsersAll() {
    let UserSchemaModel = mongon.model(UserSchema);
    return await UserSchemaModel.findAll();
  },
  async createUsers({ name, email, code }) {
    console.log("createUsers", { name, email, code });
    let UserSchemaModel = mongon.model(UserSchema);
    let user = new UserSchemaModel({
      name: name,
      email: email,
      code: code,
      isActive: "Y",
      isEnabled: true,
      isDefaultValue: false,
      isAdmin: false,
    });
    await user.save();
    return user;
  },
};
