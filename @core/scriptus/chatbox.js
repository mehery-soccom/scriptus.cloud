const ScriptBox = require("./scriptbox");
const Snippets = require("./snippets");
const BotContextStore = require("./store/BotContextStore");
const BotCodeStore = require("./store/BotCodeStore");

const path = require("path");
const coreutils = require("../utils/coreutils");
const { cachebox } = require("@bootloader/redison");

const ROOT_DIR = null; //path.resolve(__dirname);

function ChatBox({ adapter }) {
  let context = null;
  const $context = (async function () {
    context = await adapter.toContext();
    context.domain = context.tnt || context.domain;
    context.tnt = context.domain;
    context.appId = context.app_id || context.appId;
    context.contactId = context.contact_id || context.contactId;
    context.sessionId = context.session_id || context.sessionId;
    return context;
  })();

  this.init = async function ({ contact: { userData, session } }) {
    await $context;
    const sb = new ScriptBox({
      name: context.appCode,
      id: context.appId,
      async load() {
        let { code, config, botFlow: story } = await BotCodeStore.getBotCode({ appId: context.appId });
        return { code, config, options: null, story };
      },
    });

    let script = await sb.loaded();
    //console.log("===sb.getScript",script)
    //Create Snippets Context
    const $ = new Snippets({
      //Meta
      ...context,
      // Session
      session: session, //??
      userData: userData,
      config: {}, //scriptConfig ???
      script: script,
      domainbox: cachebox({
        name: "domainbox",
        domain: context.domain,
        ttl: 60 * 60 * 24 * 1,
      }),
      sessionbox: cachebox({
        name: "sessionbox",
        domain: context.domain,
        context: context.session_id,
        ttl: 60 * 60 * 24 * 3,
      }),
      adapter: adapter,
      has: sb.has,
      hasFunction: sb.hasFunction,
      execute: sb.execute,
      setting: sb.setting,
    });

    //Create ScriptBox Context and Run it
    await sb
      .context({
        // inbound: inbound,
        // message: text,
        // userData: userData,
        // inputCode: inputCode,
        setTimeout: setTimeout,
        $: $,
        console: $.console,

        // setResolver: function (resolverName) {
        //   dbservice.setResolver(app_id, resolverName, contact_id, tnt);
        // },
        // data: function (key, value) {
        //   return $.store.data(key, value);
        // },
        // clearSession: function () {
        //   var contactDetails = { contact_id: contact_id, app_id: app_id, tnt: tnt };
        //   dbservice.clearSession(contactDetails);
        //   contact.session.handler = [];
        //   contact.session.promise = [];
        // },
        // clearUserData: function () {
        //   var contactDetails = { contact_id: contact_id, app_id: app_id, tnt: tnt };
        //   dbservice.clearUserData(contactDetails);
        //   contact.session.userData = {};
        // },
      })
      .run({
        contextName: `${context.domain} ${context.appId}`,
        timeout: 10000,
      });
    this.$ = $;
    return sb;
  };

  this.context = async function () {
    await $context;
    let botContext = await BotContextStore.get(context);
    if (!botContext.contact) {
      console.warn(
        "Contact not Found in Mongo context.session_id=" + context.session_id + " contact_id=" + context.contact_id
      );
      return false;
    }
    let contact = botContext.contact;

    let diff = Date.now() - contact.session_timeStamp;
    if (diff > 1800000 || context.routing_id != contact.session?.routingId) {
      //Clear Session as Session is Expired
      BotContextStore.clearSession(context);
      BotContextStore.clearUserData(context);
      contact.session = null;
      contact.userData = {};
    }
    //Default Structure for Session
    contact.session = contact.session || {
      promise: [],
      handler: [],
    };
    BotContextStore.updateSessionTimeStamp(context);
    context.contact = contact;

    return context;
  };

  this.executeNative = async function () {
    const { contact } = await this.context();
    const sb = await this.init({ contact });

    //Execute Function
    var returnValue = null;
    if (coreutils.toFunction(adapter.isSessionStart)()) {
      try {
        if (sb.has("onSessionStart")) returnValue = await sb.execute("onSessionStart");
      } catch (e) {
        console.error("onSessionStartException", e);
      }
    } else if (coreutils.toFunction(adapter.isSessionRouted)()) {
      try {
        if (sb.has("onSessionRouted")) returnValue = await sb.execute("onSessionRouted");
      } catch (e) {
        console.error("onSessionRoutedException", e);
      }
    } else if (contact.session.handler?.length > 0) {
      try {
        returnValue = await this.$.reply._handle();
      } catch (e) {
        console.error("onMessageListenException", e);
      }
    } else {
      try {
        if (sb.has("onMessageReceive")) returnValue = await sb.execute("onMessageReceive");
      } catch (e) {
        console.error("onMessageReceiveException", e);
      }
    }

    var commitDetails = {
      app_id: context.appId,
      tnt: context.domain,
      contact_id: context.contact_id,
      contact: contact,
    };

    // console.log("commitDetails", JSON.stringify(commitDetails.contact))

    if (returnValue && returnValue.then) {
      returnValue.then(function () {
        BotContextStore.commit(commitDetails);
      });
    } else {
      let now = Date.now();
      let expired = now + 10000;
      while (returnValue != null && now < expired) {
        if (
          returnValue.__info__ != null &&
          returnValue.__info__.type == "snippet" &&
          returnValue.__info__.snippet == "promise"
        ) {
          var promise = contact.session.promise[contact.session.promise.length - 1];
          try {
            returnValue = await sb.execute(promise.resolver);
          } catch (e) {
            $.console.error("onPromiseResolveException", e);
          }
        } else {
          returnValue = null;
        }
        now = Date.now();
      }
      await BotContextStore.commit(commitDetails);
    }
    //
  };

  this.execute = async function () {
    try {
      return await this.executeNative();
    } catch (e) {
      console.error("Message Process Failed : Skipping Message", e);
    }
  };
}

ChatBox.load = function ({ root = ROOT_DIR, dir, appDir }) {
  if (!root) {
    root = coreutils.getCallerDir();
  }
  if (!appDir) appDir = path.resolve(root, dir);

  console.log("appDir:", appDir);

  ScriptBox.load({
    root: appDir,
    dir: "./scripts/",
  });

  Snippets.load({
    root: appDir,
    dir: "./snippets/",
  });
  return ScriptBox;
};

module.exports = ChatBox;
