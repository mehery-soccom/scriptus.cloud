import { Controller, RequestMapping, ResponseBody, OpenAPI } from "@bootloader/core/decorators";

import SendCampaignJob from "../workers/SendCampaignJob";
import SendMessageJob from "../workers/sendMessageJob";
import OpenAI from "openai";

const console = require("@bootloader/log4js").getLogger("ChatController");

let jobCounter = 0;
let taskCounter = 0;

@Controller({ path: "/" })
export default class JobController {
  constructor() {
    console.log("===JobController instantiated:", this.constructor);
  }

  @OpenAPI({ query: { jobId: "xyz123" } })
  @ResponseBody
  @RequestMapping({ path: "/add_job", method: "get" })
  async pushJob({
    request: {
      query: { jobId },
    },
  }) {
    let data = { id: ++jobCounter, name: "John Doe", time: Date.now() };
    SendCampaignJob.run(data, { jobId });
    return [data];
  }

  @OpenAPI({ form: { queue: 1, name: "John Doe", time: Date.now() } })
  @ResponseBody
  @RequestMapping({ path: "/execute_task", method: "post" })
  async execute_task({
    request: {
      body: { queue = "my_unique_queue" },
    },
  }) {
    console.log("===execute_task");
    let data = { id: ++taskCounter, name: "John Doe", time: Date.now() };
    SendCampaignJob.execute(data, {
      queue: queue,
    });
    return [data];
  }

  @OpenAPI({ query: { channelId: "" } })
  @ResponseBody
  @RequestMapping({ path: "/send_message", method: "get" })
  async triggerSendMessage({ request: { query } }) {
    const { channelId } = query;

    if (!channelId) {
      return { status: "error", message: "channelId is required" };
    }

    const jobData = {
      channelId,
      timestamp: Date.now(),
    };

    SendMessageJob.execute(jobData, { debounceKey: channelId });

    return {
      status: "queued",
      message: `Message job queued for channelId ${channelId}`,
      jobData,
    };
  }
}
