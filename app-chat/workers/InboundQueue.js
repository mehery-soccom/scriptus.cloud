import { Job } from "@bootloader/core/decorators";
import { ChatBox } from "./../../@core/scriptus";
import { XMSAdapter, LocalAdapter } from "./../../@core/scriptus/adapters";
import { context } from "@bootloader/utils";
import mongon from "@bootloader/mongon";
import BotContextSchema from "../../@core/scriptus/model/BotContextSchema";
import e from "connect-timeout";

const log4js = require("@bootloader/log4js");
const console = log4js.getLogger("InboundQueue");

ChatBox.load({
  dir: "../",
});

@Job({ name: "inboundQueue", workers: 4, executionStrategy: Job.EXECUTION_STRATEGY.SEQUENTIAL })
export default class InboundQueue {
  async onRun(job, {}) {
    console.log(`reading`, job);
  }

  async onExecute(task, { queue }) {
    console.log("InboundQueue > execute", { task, queue });
    console.log("<<<<<TENANT:", context.getTenant());
    const contact_id = queue;
    mongon.model(BotContextSchema);
    new ChatBox({
      adapter: task.meta
        ? new XMSAdapter({ message: task, contact_id })
        : new LocalAdapter({ message: task, contact_id }),
    }).execute();
  }
}
