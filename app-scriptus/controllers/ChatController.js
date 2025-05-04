import { Controller, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";
import { redis, RQueue, waitForReady } from "@bootloader/redison";
import { XMSAdapter, LocalAdapter } from "./../../@core/scriptus/adapters";
const config = require("@bootloader/config");

const BotConsoleStore = require("../../@core/scriptus/store/BotConsoleStore");

import InboundQueue from "../workers/InboundQueue";
import crypto from "crypto";

@Controller("/")
export default class ChatController {
  constructor() {
    console.log("===ChatController instantsiated:", this.constructor);
  }

  @ResponseView
  @RequestMapping({ path: "/home", method: "get" })
  async homePage() {
    return "home";
  }

  @RequestMapping({ path: "/api/messages", method: "post" })
  @ResponseBody
  async postMessage({ request: { body, cookies }, response }) {
    let contact_id = cookies.contact_id;
    if (!contact_id) {
      contact_id = crypto.randomUUID();
      response.cookie("contact_id", contact_id, { maxge: 900000, httpOnly: true });
    }
    InboundQueue.task(body, {
      queue: contact_id,
    });
    return { results: [body] };
  }

  @RequestMapping({ path: "/api/message/inbound", method: "post" })
  @ResponseBody
  async postMessageInbound({ request, response }) {
    const { body, cookies } = request;

    const contact_id = body?.contacts?.[0]?.contactId;

    if (!contact_id) {
      throw Error("Contact ID is missing");
    }

    InboundQueue.execute(body, {
      queue: contact_id,
    });

    return {};
  }

  @RequestMapping({ path: "/api/console/logs", method: "get" })
  @ResponseBody
  async getConsoleLogs({
    request: {
      query: { app_id, contact_id, domain },
      cookies,
    },
  }) {
    if (!contact_id) {
      contact_id = cookies.contact_id;
      app_id = LocalAdapter.config.appId;
      domain = LocalAdapter.config.domain;
    }

    let logs = await BotConsoleStore.get({ app_id, contact_id, domain });

    return {
      status: "SUCCESS",
      results: logs,
    };
  }

  @ResponseBody
  @RequestMapping({ path: "/api/messages", method: "get" })
  async getMessage({ request: { body, cookies }, headers, response }) {
    let contact_id = cookies.contact_id;
    if (!contact_id) {
      contact_id = crypto.randomUUID();
      response.cookie("contact_id", contact_id, { maxge: 900000, httpOnly: true });
    }
    let msg = await RQueue({ key: contact_id }).pop();
    return { results: msg ? [msg] : [] };
  }

  @ResponseView
  @RequestMapping({ path: "/*", method: "get" })
  async defaultPage() {
    return "home";
  }

  @ResponseBody
  @RequestMapping({ path: "/api/session/reset", method: "delete" })
  async resetSession({ response }) {
    response.clearCookie("contact_id"); // Removes 'session_token' cookie
    return {};
  }

  @ResponseBody
  @RequestMapping({ path: "/api/session/webhook", method: "post" })
  async setWebhook({ response }) {
    let ngrokDomain = config.get("ngrok.domain");
    return XMSAdapter.webhook({
      url: `https://${ngrokDomain}/scriptus/api/message/inbound`,
    });
  }

  @ResponseBody
  @RequestMapping({ path: "/api/session/webhook", method: "delete" })
  async resetWebhook({ response }) {
    return XMSAdapter.webhook({
      url: "",
    });
  }
}
