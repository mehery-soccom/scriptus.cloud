const fetch = require("node-fetch");
const config = require("@bootloader/config");
import ajax from "../../ajax";
const BotConsoleStore = require("../../scriptus/store/BotConsoleStore");

const console = require("@bootloader/log4js").getLogger("XMSAdapeter");

var scriptusSecret = config.getIfPresent("mry.scriptus.secret");
var scriptusId = config.getIfPresent("mry.scriptus.id");
var scriptusKey = config.getIfPresent("mry.scriptus.key", "mry.scriptus.secret");
var scriptusQueue = config.getIfPresent("mry.scriptus.queue");
var scriptusServer = config.getIfPresent("mry.scriptus.server");
var scriptusDomain = config.getIfPresent("mry.scriptus.domain");

var messageTypes = ["template", "audio", "document", "image", "location", "text", "video", "voice", "contacts"];

function XMSAdapeter({ message: messageBody }) {
  let domain = messageBody.meta.domain;
  let server = messageBody.meta.server || scriptusServer;
  let appId = messageBody.meta.appId;
  let contactId = messageBody.contacts[0]?.contactId;
  let toDebug = messageBody?.meta?.debug || false;

  var base_url = "https://" + domain + "." + server + "/xms";
  var headers = {
    "x-api-key": scriptusSecret,
    "x-api-id": appId,
  };

  this.toContext = async function () {
    toDebug = toDebug || BotConsoleStore.isDebugContact(contactId);
    var context = {
      meta: messageBody.meta,
      //Meta
      isDebug: toDebug,
      server: server,
      tnt: domain,
      domain: domain,
      app_id: appId,
      appCode: messageBody.meta.appCode,
      appType: messageBody.meta.appType,
      //Contact
      contact_id: contactId,
      channel_id: messageBody?.contacts[0]?.channelId,

      //Ibound
      inbound: {
        //Original
        contact: messageBody.contacts[0],
        //Derived
        getText() {
          return this.message?.text?.body;
        },
        getCode() {
          return this.message?.input?.reply_id;
        },
      },
    };

    if (messageBody.messages?.length > 0) {
      context = {
        ...context,
        text: messageBody.messages[0]?.text?.body,
        inputCode: messageBody.messages[0]?.input?.reply_id,
        session_id: messageBody.messages[0]?.session?.sessionId,
        routing_id: messageBody.messages[0]?.session?.routingId,
        inbound: {
          ...context.inbound,
          //Original
          message: messageBody.messages[0],
        },
      };
    } else if (messageBody.events?.length > 0) {
      var event = messageBody.events[0];
      var eventCode = event.eventCode;
      if (eventCode == "SESSION_ROUTED") {
        let params = event.sessionRouted?.params || {};
        context = {
          ...context,
          session_id: event.sessionId,
          routing_id: event.session.routingId,
          text: "",
          inputCode: "",
          params: params,
          inbound: {
            ...context.inbound,
            //Original
            event: event,
            //Derived
            getEvent() {
              return event.type || eventCode;
            },
            params: JSON.parse(JSON.stringify(params)),
          },
        };
      }
    }
    return context;
  };

  this.isSessionStart = function () {
    const event = messageBody.events?.[0] || {};
    let result;
    if (
      event.sessionRouted &&
      (event.sessionRouted?.sessionStart ||
        !event.sessionRouted?.sourceQueue ||
        event.sessionRouted?.sourceQueue == event.sessionRouted?.targetQueue)
    ) {
      result = true;
    } else {
      result = false;
    }
    if (result) console.log("isSessionStart", result);
    return result;
  };

  this.isSessionRouted = function () {
    const event = messageBody.events?.[0] || {};
    let result;
    if (
      event.sessionRouted &&
      (!event.sessionRouted?.sessionStart ||
        event.sessionRouted?.sourceQueue ||
        event.sessionRouted?.sourceQueue != event.sessionRouted?.targetQueue)
    ) {
      result = true;
    } else {
      result = false;
    }
    if (result) console.log("isSessionRouted", result);
    return result;
  };

  this.sendMessage = async function (options) {
    if (options.text && typeof options.text == "string") {
      options.text = {
        body: options.text,
      };
    }

    for (var i in messageTypes) {
      let type = messageTypes[i];
      if (options[type]) {
        options.type = type;
        break;
      }
    }

    const formData = {
      channelId: messageBody?.contacts[0]?.channelId,
      to: {
        contactId: messageBody.contacts[0].contactId,
      },
      type: options.type,
      options: options.options,
      image: options.image,
      video: options.video,
      document: options.document,
      audio: options.audio,
      voice: options.voice,
    };
    formData[options.type] = options[options.type];
    const url = `https://${messageBody.meta.domain}.${messageBody.meta.server}/xms/api/v1/message/send`;
    const headers = {
      "x-api-key": scriptusSecret,
      "x-api-id": messageBody.meta.appId,
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    };
    // console.log("===>   POST : ", { url, headers, formData });
    const response = await fetch(url, {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      mode: "cors", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      credentials: "same-origin", // include, *same-origin, omit
      headers,
      redirect: "follow", // manual, *follow, error
      referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify(formData), // body data type must match "Content-Type" header
    });
    const json = await response.json();
    if (json.statusKey == "SUCCESS") {
      //console.log("xms:SUCCESS");
    } else {
      console.log("xms:REQUEST", JSON.stringify(formData));
      console.log("xms:FAILED" + json.statusKey, json);
    }

    return json;
  };

  this.routeSession = async function (options) {
    //console.log(`routeSession(${options})`, options);
    return await ajax({
      url: base_url + "/api/v1/session/routing",
      headers,
    })
      .post(options)
      .json();
  };

  this.closeSession = async function (options) {
    return await ajax({
      url: base_url + "/api/v1/session/close",
      headers,
    })
      .post(options)
      .json();
  };
}

XMSAdapeter.webhook = async function (options) {
  if (!scriptusDomain) {
    return { error: "scriptusDomain not configured" };
  }
  let apiUrl = "https://" + scriptusDomain + "." + scriptusServer + "/xms/api/v1/config/webhook";
  return await ajax({
    url: apiUrl,
    headers: {
      "x-api-key": scriptusKey,
      "x-api-id": scriptusId,
    },
  })
    .post(options)
    .json();
};

module.exports = XMSAdapeter;
