import { Controller, OpenAPI, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";
const log4js = require("@bootloader/log4js");
import { ensure } from "@bootloader/utils";
import config from "@bootloader/config";

const console = log4js.getLogger("TuberController");

@Controller("/")
export default class TuberController {
  constructor() {
    console.info("===TuberController instantsiated:", this.constructor);
  }
  @ResponseView
  @RequestMapping({ path: "/*", method: "get" })
  async defaultPage() {
    return "home";
  }
}
