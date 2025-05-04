const config = require("@bootloader/config");
const log4js = require("@bootloader/log4js");
const { context } = require("@bootloader/utils");
const { requireOptional } = require("@bootloader/utils");
const mongonPing = require("@bootloader/mongon/ping");
const redisonPing = require("@bootloader/redison/ping");

const { Snippets } = require("../../@core/scriptus");

import { Controller, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";

var pjson = requireOptional(".../../../package.json|../../package.json|../package.json|./package.json");
var bjson = requireOptional(
  "../../../public/build.info.json|../../public/build.info.json|../public/build.info.json|./public/build.info.json"
);
const UP_STAMP = new Date();
const UP_TIME = Date.now();

const LOGGER = log4js.getLogger("AppInfoController");

@Controller("/info")
export default class AppInfoController {
  constructor() {
    LOGGER.log("===AppInfoController instantiated:", this.constructor);
  }

  @ResponseBody
  @RequestMapping({ path: "/build", method: "get" })
  async getBuildInfo() {
    LOGGER.info("getBuildInfo");
    return {
      package_version: pjson.version,
      app_name: config.getIfPresent("app.name"),
      app_version: config.getIfPresent("app.version"),
      db_prefix: config.getIfPresent("mongodb.db.prefix"),
      db_prefix: config.getIfPresent("mongodb.db.prefix"),
      db_domain: config.getIfPresent("mongodb.db.domain"),
      UP_TIME: UP_TIME,
      UP_STAMP: UP_STAMP.toISOString(),
      build: bjson,
      node_version: process.version,
      snippets: Snippets.listAll(),
      context: {
        tnt: context.getTenant(),
        traceId: context.getTraceId(),
      },
    };
  }

  @ResponseBody
  @RequestMapping({ path: "/mongo", method: "get" })
  async getMongoInfo() {
    LOGGER.info("getMongoInfo");
    let resp = {};
    resp.mongon = await mongonPing.push();
    return resp;
  }

  @ResponseBody
  @RequestMapping({ path: "/redis", method: "get" })
  async getRedisInfo() {
    LOGGER.info("getRedisInfo");
    let resp = {};
    resp.redisson = await redisonPing.get({ domain: "domain", type: "type", key: "key" });
    return resp;
  }
}
