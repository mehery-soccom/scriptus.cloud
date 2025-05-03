import { Controller, OpenAPI, RequestMapping, ResponseBody, ResponseView } from "@bootloader/core/decorators";
const log4js = require("@bootloader/log4js");
import { ensure } from "@bootloader/utils";
import config from "@bootloader/config";

import UserService from "../services/UserService";
const fs = require("fs").promises;
const path = require("path");
const console = log4js.getLogger("VdoController");
import coreutils from "../../@core/utils/coreutils";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
const VIDEO_EXTENSIONS = [".mp4", ".avi", ".mov", ".mkv", ".webm"];

function getMediaType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return {
    media_type: IMAGE_EXTENSIONS.includes(ext) ? "IMAGE" : VIDEO_EXTENSIONS.includes(ext) ? "VIDEO" : null,
  };
}

@Controller("/vdo")
export default class VdoController {
  constructor() {
    console.info("===VdoController instantsiated:", this.constructor);
  }

  @OpenAPI({ query: { dir: "" } })
  @ResponseBody
  @RequestMapping({ path: "/list", method: "get", query: {} })
  async homePage({
    request: {
      query: { dir = "" },
    },
  }) {
    let tuberDir = config.get("tuber.dir");
    let pathDir = coreutils.toPath(tuberDir, dir);
    console.info("path", pathDir);
    const entries = await fs.readdir(pathDir, { withFileTypes: true });
    return entries
      .filter((entry) => {
        if (entry.isDirectory()) return true;
        const ext = path.extname(entry.name).toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
      })
      .sort((a, b) => {
        if (a.isDirectory() && b.isDirectory()) return a.name.localeCompare(b.name);
        if (a.isDirectory()) return -1;
        if (b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        return {
          ...entry,
          type: entry.isDirectory() ? "dir" : "file",
          name: entry.name,
          ...getMediaType(entry.name),
          url: coreutils.toPath("/media/", dir, entry.name),
        };
      });
  }

  @RequestMapping({ path: "/create", method: "post", form: { name: "NAME", email: "name@name.com", code: "COD" } })
  @ResponseBody
  async postMessage({
    request: {
      body: { name, email, code },
      cookies,
    },
    response,
  }) {
    ensure.params({ name, email, code }).required();
    console.log("createUsers", { name, email, code });
    return UserService.createUsers({ name, email, code });
  }
}
