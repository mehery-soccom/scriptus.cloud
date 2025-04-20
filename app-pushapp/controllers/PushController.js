import { Controller, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";
import mongon from "@bootloader/mongon";
import { context } from "@bootloader/utils";
const log4js = require("@bootloader/log4js");
const console = log4js.getLogger("ChatController");

/*
  /pushapp/api/... // apis
  /pushapp/pub/... // pub apis

  /pushapp/app/... // web route with session
  /pushapp/auth/... // web route without session
*/

@Controller("/")
export default class PushController {
  constructor() {
    console.info("PushController instantsiated:", this.constructor);
  }

  @RequestMapping({ path: "/api/register", method: "post" })
  @ResponseBody
  async postRegister({ request: { body, cookies }, response }) {
    console.log("post : /api/register", {});

    return { data: {}, results: [] };
  }

  @RequestMapping({ path: "/pub/api/register", method: "get" })
  @ResponseBody
  async getRegister({ request: { body, cookies }, response }) {
    console.log("get : /api/register", {});

    return { data: {}, results: [] };
  }

  @RequestMapping({ path: "/*", method: "get" })
  @ResponseView
  async defaultPage({ request: { headers, cookies }, response }) {
    if (headers["host"].startsWith("localhost") || (cookies?.CDN_URL || "").includes("localhost")) {
      return "local_index";
    } else {
      return "index";
    }
  }
}
