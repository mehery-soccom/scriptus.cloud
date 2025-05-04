import { Job } from "@bootloader/core/decorators";
import { ChatBox } from "./../../@core/scriptus";
import { XMSAdapter, LocalAdapter } from "./../../@core/scriptus/adapters";

ChatBox.load({
  dir: "../",
});

@Job({ name: "inboundQueue", workers: 4, executionStrategy: Job.EXECUTION_STRATEGY.SEQUENTIAL })
export default class InboundQueue {
  async onRun(job, {}) {
    console.log(`running...`, job);
  }

  async onExecute(message, { queue }) {
    //console.log("InboundQueue > execute > " + queue, JSON.stringify(message));
    const contact_id = queue;
    const sessionId = queue;
    try {
      new ChatBox({
        adapter: message.meta
          ? new XMSAdapter({ message: message, contact_id, sessionId })
          : new LocalAdapter({ message: message, contact_id, sessionId }),
      }).execute();
    } catch (e) {
      console.error("InboundQueue > execute > ", e);
    }
  }

  async onPush(data) {
    console.log("data====", data);
  }
}
