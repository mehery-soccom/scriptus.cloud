const OpenAIService = require("../clients/OpenAIService");

// const { DEFAULT_INTENT_SERVICE_KEY } = require("../service/settings");
const DEFAULT_INTENT_SERVICE_KEY = "DEFAULT_INTENT_SERVICE_KEY";

module.exports = function (
  $,
  { server, tnt, app_id, domain, contact_id, channel_id, session, userData, inbound, execute, setting, domainbox }
) {
  function openai(_options = {}) {
    let options = typeof _options == "string" ? { key: _options } : _options || {};
    if(options.parameters === undefined){
      options.parameters = {}
    }
    let openAIService = new OpenAIService({ domain, domainbox, ...options });

    return {
      async init(initOptions = {}) {
        return await openAIService.init(initOptions);
      },
      async chat_completions_create(a, ...args) {
        let { client, config } = await this.init({
          provider: "AZURE",
        });
        //console.log("doc===",_options,"====",doc)
        if (!client) {
          throw "Error ( No OpenAI Provider )";
        }
        if (client.provider == "AZURE") {
          if (client.authType == "SECRET") {
            //Not Sure if this is right call, NOT TESTED :-TODO
            return client.chat.completions.create(a, ...args);
          } else if (client.authType == "TOKEN") {
            //Not Sure if this is right call, NOT TESTED :-TODO
            return await client.chat.completions.create(a, ...args);
          } else {
            return await client.chat.completions.create(a, ...args);
          }
        } else {
          //console.log("=====",a,args)
          return await client.chat.completions.create(
            {
              model: config?.model,
              ...a,
            },
            ...args
          );
        }
      },
      async next(messages, functions) {
        try {
          
          let response = await this.chat_completions_create({
            messages: (
              messages || [
                {
                  role: "system",
                  content: "You are an Agent Who is curious about user's issue and wants to solve it.",
                },
              ]
            ).filter((message) => message.content && message.content.trim() !== ""),
            functions: functions,
            function_call: functions && functions.length ? "auto" : undefined,
            max_tokens: 200,
            temperature: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            ...options.parameters
          });

          //console.log("response:",response)
          return {
            localChoice: {},
            isError() {
              return false;
            },
            getRaw: function () {
              return response;
            },
            choices: response?.choices,
            message: function (index) {
              index = index || 0;
              return response?.choices?.[index]?.message;
            },
            is(funName) {
              return response?.choices?.[0]?.function_call == funName;
            },
            function_call(callback) {
              let function_call = null;
              try {
                function_call = callback({
                  content: this.message().content,
                });
              } catch (e) {
                console.error(e);
              }
              if (function_call && function_call.name) {
                this.localChoice.function_call = function_call;
              }
              return this;
            },
            function_call_used: "",
            on(funName, callback) {
              try {
                let function_call = this.localChoice.function_call || this.message().function_call;
                if (typeof funName == "string") {
                  if (!function_call) return this;
                  let { name, args } = function_call;
                  //console.log("on:function_call", function_call);
                  args = args || function_call.arguments;
                  if (funName == name || (!this.function_call_used && funName == "*")) {
                    this.function_call_used = funName;
                    //console.log("on:", funName, name, args);
                    callback({
                      name: name,
                      args: (typeof args == "string" ? JSON.parse(args) : args) || {},
                      content: this.message().content,
                    });
                  }
                } else if (typeof funName == "function" && !function_call?.name) {
                  funName({
                    content: this.message().content,
                  });
                }
              } catch (e) {
                console.error("ERROR", e);
              }
              return this;
            },
          };
        } catch (e) {
          $.logger.error(e);
          //console.error("======",e);
          return {
            isError() {
              return true;
            },
            error() {
              return e?.error;
            },
            message() {
              return "";
            },
          };
        }
      },
    };
  }

  openai.chat = {
    completions: {
      async create(a, ...args) {
        return await openai().chat_completions_create(
          {
            max_tokens: 200,
            temperature: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            ...a,
          },
          ...args
        );
      },
    },
  };

  openai.next = async function (messages, functions) {
    return await openai().next(messages, functions);
  };

  openai.init = async function (options) {
    return await openai().init(options);
  };

  return openai;
};
