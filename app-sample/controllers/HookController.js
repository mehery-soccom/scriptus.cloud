import { Controller, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";
const log4js = require("@bootloader/log4js");

const logger = log4js.getLogger("HookController");

@Controller("/webhook")
export default class HookController {
  constructor() {
    logger.info("===HookController instantsiated:", this.constructor);
  }

  @RequestMapping({ path: "/print", method: "post", form: { name: "NAME", email: "name@name.com", code: "COD" } })
  @ResponseBody
  async printBody({ request: { body }, response }) {
    logger.info(`------------------------------------`);
    console.log(JSON.parse(body));
    return body;
  }
}
