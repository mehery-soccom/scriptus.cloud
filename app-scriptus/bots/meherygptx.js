function get_intent_prompt() {
  return [
    `You are a Customer Support Assistant for Mehery Soccom Pvt Ltd that handles faq queries about Meherys messaging services, greeting and connect to agent requests. 
** Your current task : **
You MUST classify the user input into one of the following categories and respond **only** in the exact format:  
intent(<intent_name>:<params>)  
Any deviation from this format is strictly prohibited. Based in the guidelines, examples and instructions provided below.

The possible intents are:

1. **faq_query**  
- If the user's query is about Meherys Messaging services.  
- These will be handled by a RAG system, so your job is only to return the intent.

3. **connect_agent**  
- Use this intent if the user explicitly asks to speak to a human/live agent, uploads a file, or if the user is abusive or their request cannot be fulfilled via the system.

4. **greeting**    
- For greetings like "hi","hello","how are you ?", "what can you do ?", "what are you ?" or introductory messages, choose an appropriate helpful response.
- In the appropriate message describe yourself along with your capabilities as preciesly as possible.  
  The format must be: "intent(greeting:<appropriate message>)"

5. **No Intent**  
- If none of the above categories match, return nothing. Do not invent or assume intent.

---

Examples:

- User Input: "Do you transfer money to Nepal?"  
  Response: intent(faq_query)

- User Input: "What is the exchange rate for USD?"  
  Response: intent(exchange_rates:USD)

- User Input: "Can I speak to a human?"  
  Response: intent(connect_agent)

- User Input: "Do you transfer EUR to Canada?"  
  Response: intent(faq_query)

- User Input: "What are the rates today?"  
  Response: intent(exchange_rates:unknown)

---

IMPORTANT RULES:
- Do not refer to Mehery Soccom Pvt Ltd in third person.
- Only return a single line in the required format. No explanations or extra text.
- Keep asking follow-up questions **only if** the intent is unclear AND no intent has been returned yet.`
  ];
}

const functions = [
  {
    name: "connect_agent",
    description: "Transfers the conversation to a live agent",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "greeting",
    description: "Respond to a greeting message from user",
    parameters: {
      type: "object",
      properties: {
        currency: {
          type: "string",
          description: "Appropriate response to users greeting",
        },
      },
    },
  },
  {
    name: "faq_query",
    description: "Handles general customer inquiries or FAQs",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "User's question or inquiry",
        },
      },
    },
  },
];

function onSessionStart() {
  console.log("=======================almullagpt====onSessionStart===");
}

function onSessionRouted() {
  console.log("=======================almullagpt====onSessionRouted===");
}

/*
async function onMessageReceive() {
  console.log("=======================almullagpt====onMessageReceive===");
  await $.reply(`Response(${$.inbound.getText()})`).listen(listenHandler);
}
async function listenHandler() {
  console.log("listenHandler");
  await $.reply(`2 Response(${$.inbound.getText()})`);
}
*/

async function onMessageReceive() {
  //return await onHandleDefault();
  let inputCode = ($.inbound.getCode() || "").toUpperCase();
  //$.logger.log("handleInput", inputCode);
  //$.console.log("handleInput", inputCode);
  switch (inputCode) {
    case "C":
    case "#":
      await assignToAgent();
      break;
    case "M":
    case "*":
      await $.reply({
        template: "main_menu",
      });
      break;
    case "E":
      //console.log()
      return $.session.close();
    default:
      return await onHandleDefault();
  }
}

async function onHandleDefault() {
  //console.log("onHandleDefault");
  const inboundMessage = $.inbound;
  const message = inboundMessage.message;
  // console.log(`message : ${JSON.stringify(inboundMessage)}`)
  if(message.input && message.input.reply_id && message.input.reply_title){
    console.log("Handling button reply");
    const button_reply = message.input.reply_id ;
    let { rawHistory , history , sessionId , userquestion } = await $.dorag().getHistoryForTransferToAgent();
    if(button_reply === 'Yes'){
      console.log("Transfering to a agent.");
      const convo = {
        sessionId,
        rephrasedQuestion : 'Yes',
        messages: {
          user: userquestion,
          assistant: `We are transfering to a agent as per your request. Please be patient.`,
        },
      };
      const savedChat = await $.dorag().saveConvo(convo);
      await assignToAgent(history, `We are transfering to a agent as per your request. Please be patient.`);
    } else {
      console.log("Continueing chat.");
      const convo = {
        sessionId,
        rephrasedQuestion : 'No',
        messages: {
          user: userquestion,
          assistant: `Okay we will continue this chat. How may I help you ?`,
        },
      };
      const savedChat = await $.dorag().saveConvo(convo);
      await respond(`Okay we will continue this chat. How may I help you ?`, history);
    }
  } else {
    console.log("Handling plain text message");
    const {
      bot_introduction,
      no_info_response,
      rephrasing_rules,
      rephrasing_conflict_resolution_rules,
      rephrasing_examples,
      answer_llm
    } = await $.session.app.options();
    let {
      history,
      rawHistory,
      sessionId,
      function_call,
      message,
      userText: userquestion,
    } = await $.dorag().getIntentWithContext({
      systemPrompts: get_intent_prompt(),
      functions,
    });
    
    console.log("resp.message()", message());
    
    function_call &&
      function_call(function ({ content }) {
        console.log("intentResponse", content);
        //const match = content.match(/intent\((?<intent>\w+)(:(?<params>[\w\d]+))?\)/i);
        const match = content?.match(/intent\((?<intent>\w+)(:(?<params>.+?))?\)/);
        if (match && match.groups) {
          console.log("function_call:MATCHED")
          let arg1 = match.groups.params ? match.groups.params.trim() : null;
          let cleanedContent = content.replace(match[0], "").trim();
          //console.log("cleanedContent=",cleanedContent)
          console.log(`matched name : ${match.groups.intent}`);
          console.log(`matched response : ${cleanedContent || content}`);
          console.log(`matched arg1 : ${arg1}`);
          return {
            name: match.groups.intent,
            args: {
              currency: arg1,
              response: cleanedContent || content,
            },
          };
        } else if (["faq_query", "exchange_rates", "connect_agent", "greeting"].indexOf(content) > -1) {
          console.log("function_call:MAPPED")
          return {
            name: content,
            args: {},
          };
        }
        console.log("function_call:NONE")
        return {
          // name: "greetings", args: {}
        };
      })
        .on("greeting", async function ( { name , args } ) {
          console.log("INTENT:greeting", name, args);
          const convo = {
            sessionId,
            rephrasedQuestion : userquestion,
            messages : {
              user : userquestion,
              assistant : args.currency
            }
          }
          const savedChat = await $.dorag().saveConvo(convo);
          await respond(args.currency, history); 
        } )
        .on("connect_agent", async function ({ name, args }) {
          console.log("INTENT:connect_agent", name, args);
          const willing_fileUpload_or_abusive_connect_agent = `We are transfering to a agent as per your request. Please be patient`
          await assignToAgent(history, willing_fileUpload_or_abusive_connect_agent);
        })
        .on("*", async function ({ content }) {
          console.log(`CONTENT : ${JSON.stringify(content)}`);
          console.log("INTENT:faq_query");
          console.log(`sessionId: ${sessionId}`);
          console.log(`userquestion: ${userquestion}`);
    
          // const rephrasedQuestion = await $.dorag().rephrase(message);
          // const topMatches = await $.dorag().rag(rephrasedQuestion);
          const { rephrasedQuestion, relevantInfo, matches } = await $.dorag().rephraseWithRag({
            userquestion,
            rawHistory,
            rephrasingRules: rephrasing_rules,
            rephrasingConflict: rephrasing_conflict_resolution_rules,
            rephrasingExamples: rephrasing_examples,
          });
          console.log(`relevant info : ${relevantInfo}`);
          
          const sys_prompt = 
    `- If the retrieved information contains an answer that directly or indirectly addresses the user's question, respond using that information.
    - This includes cases where the information implies a negative answer (e.g., if a currency, channel of transfer or service is not listed as available for a country, 
    answer that it's not available).
    - Compare lists carefully - if a user asks if X is possible and X is not in the list of possibilities, answer "no" based on the retrieved data.
    - If no relevant information is found to either confirm or deny the user's question, trigger information_not_available() function provided as a tool.
    - Do not require an exact wording match to provide an answer.
    - Do not omit any information while answering.
    Never invent information. Prioritize using retrieved knowledge.`;
    // - Answer in plain text only. Do not use any markdown formatting like *, **, or _.
          const user_prompt = 
    `Answer the user's question using the most relevant retrieved information from the Relevant Information above.
    - If a retrieved FAQ directly answers the question, provide that answer.
    - If the information implies a negative answer (e.g. feature or service not being in a list of supported features & services means 
    it's not supported), clearly state this negative conclusion.
    - When comparing lists, be thorough - if something is not in a list where it would be if it were allowed/supported, conclude it's not allowed/supported.
    - If no information can be found that either confirms or denies the user's question, trigger 'information_not_available()' function provided as tool.`;
          const answer = await $.dorag().askllm({
            botIntroduction: bot_introduction,
            relevantInfo,
            rephrasedQuestion,
            noInfoResponse: no_info_response,
            sys_prompt,
            user_prompt,
            model: answer_llm,
          });
          
          if (answer.valid) {
            // console.log(`answer : ${answer.ans}`);
            const formatted_answer = await $.dorag().markDownToWhatsAppFormatter(answer.ans);
            // console.log(`formatted answer : ${formatted_answer}`);
            const convo = {
              sessionId,
              rephrasedQuestion,
              matches,
              messages: {
                user: userquestion,
                assistant: formatted_answer,
              },
            };
            const savedChat = await $.dorag().saveConvo(convo);
            await respond(formatted_answer, history);
          } else {
            const convo = {
              sessionId,
              rephrasedQuestion,
              matches,
              messages: {
                user: userquestion,
                assistant: answer.ans,
              },
            };
            const savedChat = await $.dorag().saveConvo(convo);
            await $.reply({
              template: {
                code: "chat_transfer_to_agent_permission"
              }
            });
          }
        })
        .on(async function ({ content }) {
          console.log("INTENT:DEFAULT");
          console.log(`default content : ${JSON.stringify(content)}`);
          const default_case_response = `I am a Customer Support Assistant for Mehery Soccom Pvt Ltd that handles faq queries about Mehery's messaging services and help you to connect with a agent requests.
    How may I help you ?`
          const convo = {
            sessionId,
            rephrasedQuestion : userquestion,
            messages : {
              user : userquestion,
              assistant : default_case_response
            }
          }
          const savedChat = await $.dorag().saveConvo(convo);
          await respond(default_case_response, history);
        });
  }
}
async function create_prompt(systemContents, history, instructions) {
  instructions = instructions || [];
  let x = [
    ...systemContents.map(function (content) {
      return { role: "system", content: content };
    }),
    ...history,
    ...instructions.map(function (content) {
      return { role: "user", content: content };
    }),
  ];
  //console.log("x",x)
  return x;
}

async function respond(answer, history, dummy) {
  //console.log("Responding", answer);
  history.push({
    role: "assistant",
    content: `${answer}`,
  });
  await $.store.local.set("history", history);
  if (!dummy)
    await $.reply({
      text: { body: `${answer}` },
      // options: {
      //   buttons: [
      //     {
      //       code: "#",
      //       label: "Chat with Agent",
      //     },
      //     {
      //       code: "E",
      //       label: "Exit Chat",
      //     },
      //   ],
      // },
    });
}

async function assignToAgent(history, response) {
  if (!history) {
    let historyResp = await $.store.local("history");
    history = historyResp.history || [];
  }
  //console.log("Escalation triggered. Routing to human agent...");
  const options = await $.session.app.options();
  let prompt = await create_prompt([options.assistant_prompt], history, [
    `
        ${options.conversation_summary_prompt}
      `,
  ]);
  let resp2 = await $.openai({ useGlobalConfig: true , parameters : { model : "gpt-4o-mini" , temperature : 0 }}).next(prompt);
  if (response) {
    await respond(response, history);
  }
  try {
    console.log("note >", resp2.message().content);
    await $.session.route.to.agent({
      note: resp2.message().content,
    }); // Redirect to human agent
    console.log("agent call success");
  } catch (e) {
    console.log("agent call failure", e);
  }
}