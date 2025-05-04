import ajax from "../../@core/ajax";
import ChainedPromise from "../../@core/lib/ChainedPromise";
import { webChatSchema } from "../models/WebChatModel";
import { collection_name } from "../models/clients";
import { vectorDb } from "../models/clients";
import { MetricType } from "@zilliz/milvus2-sdk-node";
import { getExeTime } from "../../@core/utils/exetime";
import mongon from "@bootloader/mongon";
import { context } from "@bootloader/utils";
import config from "@bootloader/config";
import { raw } from "body-parser";
const OpenAIService = require("../../@core/scriptus/clients/OpenAIService");

const MRY_SCRIPTUS_DOMAIN = config.getIfPresent("mry.scriptus.domain"); // Replace with your actual tenant partition key

async function generateEmbeddingOpenAi(text, dims = 512) {
  try {
    let service = new OpenAIService({ useGlobalConfig: true });
    let { client: openai, config } = await service.init();
    let start = Date.now();
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small", // You can replace with your preferred embedding model
      input: text,
      encoding_format: "float",
      dimensions: dims,
    });
    await getExeTime("getEmbeddingOpenAi", start);
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding with open ai:", error);
    throw error;
  }
}

async function information_not_available() {
  return `Information you are asking for is not available currently.
  For more information: You can WhatsApp or Call us: +965 1840 123. 
  For more information, please contact us on 1840123 . 
  You can reach out to us on email: Help@almullaexchange.com.
  For better understanding of your query we will transfer to agent.`;
}

async function getModelResponse(context) {
  let start = Date.now();
  const botIntro = context.botIntroduction || "You are a AI assistant. \nUse the provided information to answer the user's question."
//   const systemPrompt = `${botIntro}
// - If the retrieved information contains an answer that matches the meaning of the user's question, respond using that information.  
// - If the wording differs but the meaning is the same, still answer using the retrieved data.  
// - If no relevant information is found, trigger information_not_available() function provided as a tool.  
// - Do not require an exact wording match to provide an answer.  
// - Do not omit any information while answering.
// Never invent information. Prioritize using retrieved knowledge.`;
const system_prompt = context.sys_prompt || `You will be given a list of question and answers pairs in relevant docs section. Also a user question.
Based on the relevant docs answer users question.
Verify your answers are correct before answering.
Dont omit any facts from relevant docs.
Never invent information. Prioritize using relevant information.`
const systemPrompt = `${botIntro}
${system_prompt}`;

//   const userPrompt = `
// ### Relevant Information
// ${context.relevantInfo}

// ### User Question
// ${context.rephrasedQuestion}

// Answer the user's question using **the most relevant retrieved information from the Relevant Information above**.  
// - If a retrieved FAQ answers the question (even if wording differs), provide that answer.  
// - If no relevant information is found, trigger 'information_not_available()' function provided as tool.`;
const user_prompt_part3 = context.user_prompt || `Answer the user's question using **the most relevant retrieved information from the Relevant Information above**.  
- If a retrieved FAQ answers the question (even if wording differs), provide that answer.  
- If no relevant information is found, trigger 'information_not_available()' function provided as tool.`;
const userPrompt = 
`### Relevant Information
${context.relevantInfo}

### User Question
${context.rephrasedQuestion}
${user_prompt_part3}`
  // console.log(`relevant docs : ${context.relevantInfo}`);
  // console.log(`user qts (rephrased)  : ${context.rephrasedQuestion}`);
  // console.log(`system : ${systemPrompt}`);
  // console.log(`user : ${userPrompt}`);
  let service = new OpenAIService({ useGlobalConfig: true });
  let { client: openai, config } = await service.init();
  const completion = await openai.chat.completions.create({
    model: context.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "information_not_available",
          description: "Generates a default information_not_available message",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    ],
    tool_choice: "auto",
  });
  console.log(`answer final content : ${completion.choices[0].message.content}`);
  // console.log(`answer final func : ${completion.choices[0].message.tool_calls[0].function.name || null}`);

  if (completion.choices[0].message.content === null) {
    const answer = {
      ans: context.noInfoResponse || "I dont have relevant information to your question available. Transfering to a agent for better understanding of your question.",
      valid: false,
    };
    console.log(completion.usage);
    await getExeTime("GPT", start);
    return answer;
  }

  console.log(completion.usage);
  await getExeTime("GPT", start);
  const answer = {
    ans: completion.choices[0].message.content,
    valid: true,
  };
  return answer;
}

async function saveConversation(convo) {
  const WebChat = mongon.model(webChatSchema);
  const newWebChat = new WebChat(convo);
  const savedChat = await newWebChat.save();
  return savedChat;
}
/**
 * Retrieves the 5 most recent web chats for a specific contact
 * @param {string} contactId - The ID of the contact to retrieve chats for
 * @returns {Promise<Array>} Array of recent web chats with selected fields
 */
async function getRecentWebChats(sessionId) {
  try {
    const WebChat = mongon.model(webChatSchema);
    const recentChats = await WebChat.find(
      { sessionId },
      {
        // Explicitly select only the desired fields
        messages: 1,
        timestamp: 1,
        rephrasedQuestion: 1,
        _id: 0,
      }
    )
      .sort({ timestamp: -1 }) // Sort by most recent first
      .limit(5) // Limit to 5 most recent chats

    const sortedChats = recentChats.reverse();
    return sortedChats;
  } catch (error) {
    console.error("Error retrieving recent web chats:", error);
    throw error; // Re-throw to allow caller to handle
  }
}
/**
 * Formats chat history into a string for context
 * @param {Array} chats - Array of chat objects
 * @returns {string} Formatted chat history
 */
function formatChatHistory(chats) {
  return chats
    .map((chat, index) => {
      const date = new Date(chat.timestamp).toLocaleString();
      return `Conversation ${index + 1} (${date}):\nUser: ${chat.rephrasedQuestion}\nAssistant: ${
        chat.messages.assistant
      }\n`;
    })
    .join("\n");
}

function formatChatHistoryForIntent(chats) {
  const arr = [];
  if (chats.length >= 3) {
    chats
      .slice(2) // Skip the first 2 elements
      .forEach((chat) => {
        // Use forEach instead of map to push into the array
        arr.push({ role: "user", content: chat.rephrasedQuestion });
        arr.push({ role: "assistant", content: chat.messages.assistant });
      });
  } else {
    chats.forEach((chat) => {
      // Use forEach instead of map to push into the array
      arr.push({ role: "user", content: chat.rephrasedQuestion });
      arr.push({ role: "assistant", content: chat.messages.assistant });
    });
  }

  return arr;
}
/**
 * Converts ChatGPT-style markdown to WhatsApp-compatible markdown.
 * 
 * Specifically:
 * - Converts bold text from **bold** to *bold*
 * - Converts italic text from *italic* to _italic_
 * 
 * Notes:
 * - Does not support bold+italic (***text***)
 * - Avoids false matches inside bold syntax when processing italic
 * 
 * @param {string} text - The input text with markdown formatting
 * @returns {string} - The converted text using WhatsApp-style markdown
 */
function convertMarkdownToWhatsApp(text){
  return text.replace(/(\*\*)(.*?)\1|(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, (match, boldDelim, boldText, italicText) => {
      if (boldDelim) {
          return `*${boldText}*`; // Convert **bold** → *bold*
      } else {
          return `_${italicText}_`; // Convert *italic* → _italic_
      }
  });
};

/**
 * Rephrases the current user question using OpenAI based on chat history
 * @param {string} contactId - User's contact ID
 * @param {string} currentQuestion - The current question from the user
 * @returns {Promise<string>} The rephrased question
 */
async function rephraseWithContext(context) {
  try {
    // Get recent chat history
    // console.log(`in rephraser : ${sessionId}`);
    // console.log(`in rephraser : ${context.currentQuestion}`);
    // console.log(`rawHistory in rephraseWithContext : ${context.rawHistory}`);
    // const recentChats = await getRecentWebChats(sessionId);
    // console.log(`recent chats : ${JSON.stringify(recentChats)}`);
    if (context.rawHistory.length === 0) return context.currentQuestion;
    // Format chat history as string
    const chatHistoryString = formatChatHistory(context.rawHistory);
    const rephrasingRulesFinal = context.rephrasingRules || `- Never hallucinate or assume context beyond chat history. `
    const rephrasingContextResolutionRules = context.rephrasingConflict || `If chat history has conflicting context. Always prefer latest context.
    If chat history and Current User Question has conflicting context. Always prefer Current User Question.`
    const systemPrompt = `Your task is to rephrase the user's current question in a context-aware manner using the provided chat history.  
    In "Chat History" Section conversations are ordered in cronological order.
    Conversation 1 has happened at the earliest and the higher the conversation number more recent the conversation will be.
    ### **Rephrasing Rules:**
    ${rephrasingRulesFinal}
    
    ### **Conflict Resolution:** 
    ${rephrasingContextResolutionRules}

    ### **Examples:**  
    #### Correct Behavior:
    ${context.rephrasingExamples}
    `;
    const userPrompt = `### Chat History  
${chatHistoryString}  

### Current User Question  
${context.currentQuestion}  
Rephrase the user's question using the provided context.

- Prioritize user intent and clarity while ensuring the question remains concise.  
- Avoid fabricating information or assuming context where none exists.`;
    // console.log(`rephrase system prompt : ${systemPrompt}`);
    console.log(`rephrase user prompt : ${userPrompt}`);
    // Make API call to OpenAI
    let service = new OpenAIService({ useGlobalConfig: true });
    let { client: openai, config } = await service.init();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Or another model like gpt-3.5-turbo
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0, // Lower temperature for more focused output
      max_tokens: 150, // Limit tokens for concise rephrasing
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "rephrase_question_response",
          schema: {
            type: "object",
            properties: {
              rephrasedQuestion: { type: "string" },
            },
            required: ["rephrasedQuestion"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    // Extract the rephrased question
    // const rephrasedQuestion = completion.choices[0].message.content.trim();

    const rephrasedQuestion = JSON.parse(completion.choices[0].message.content).rephrasedQuestion;
    console.log(`Original: "${context.currentQuestion}"\nRephrased: "${rephrasedQuestion}"`);
    console.log(completion.usage);
    return rephrasedQuestion;
  } catch (error) {
    console.error("Error rephrasing question:", error);
    return currentQuestion; // Fall back to original question on error
  }
}

async function semanticSearch(embedding, output_fields, field_name, topK = 2, filter = "") {
  try {
    let start = Date.now();

    // Perform vector similarity search
    const searchResult = await vectorDb.search({
      collection_name: collection_name,
      vector: embedding,
      filter: filter,
      field_name,
      limit: topK,
      output_fields,
      metric_type: MetricType.COSINE,
    });
    // console.log(`SEARCH RESULTS : `, JSON.stringify(searchResult));
    await getExeTime("VectorSearch", start);
    return searchResult.results;
  } catch (error) {
    console.error("Error performing semantic search:", error);
    throw error;
  }
}

async function performRag(rephrasedQuestion , tenant_partition_key) {
  try {
    // 1. Generate embedding for the user question
    let start = Date.now();
    const questionEmbedding = await generateEmbeddingOpenAi(rephrasedQuestion);

    // 2. Perform semantic search to find similar questions
    console.log("Performing semantic search...");
    // if in production
    // const park = context.getTenant();
    // else hard code it
    // const park = "almullaexchange";
    const searchResults = await semanticSearch(
      questionEmbedding,
      ["knowledgebase"],
      "fast_dense_vector",
      2,
      `tenant_partition_key == "${tenant_partition_key}"`
    );

    // 3. Format results for passing to the fine-tuned model
    const topMatches = searchResults.map((result) => ({
      knowledgebase: result.knowledgebase,
      score: result.score,
    }));

    console.log(`Found ${topMatches.length} relevant matches`);
    await getExeTime("RagAllMini", start);
    return topMatches;

    // The caller can then pass these top matches to their fine-tuned model
  } catch (error) {
    console.error("Error in RAG pipeline:", error);
    throw error;
  }
}

function create_prompt({ systemPrompts, conversations, instructions }) {
  instructions = instructions || [];
  let x = [
    ...systemPrompts.map(function (content) {
      return { role: "system", content: content };
    }),
    ...conversations,
    ...instructions.map(function (content) {
      return { role: "user", content: content };
    }),
  ];
  //console.log("x",x)
  return x;
}

// ONCE PER PROEJCT START
// SCOPE : PROJECT
module.exports = function ($, { session, execute, contactId, sessionId }) {
  // ONCE PER PROEJCT MESSAE INBOUND
  // SCOPE : MESSAGE
  let SOME_VARIABLE = 0; // THIS VARIABLE CAN BE CHANGED AND MAINTAINED for ONE INBOUND MESSAGES
  class DoRagPromise extends ChainedPromise {
    constructor(executor = (resolve) => resolve(0)) {
      super(executor);
    }
    getHistory() {
      return this.chain(async function (parentResp) {
        const rawHistory = await getRecentWebChats(sessionId);
        return rawHistory;
      });
    }
    getHistoryForIntent(rawHistory) {
      return this.chain(async function (parentResp) {
        const histForIntent = formatChatHistoryForIntent(rawHistory);
        return histForIntent;
      });
    }
    getHistoryWithIntent() {
      return this.chain(async function (parentResp) {
        const rawHistory = await getRecentWebChats(sessionId);
        const history = formatChatHistoryForIntent(rawHistory);
        // console.log(`history dorag : ${JSON.stringify(history)}`)
        return { history, rawHistory, sessionId };
      });
    }
    getHistoryForTransferToAgent() {
      return this.chain(async function (parentResp){
        const userText = $.inbound.getText();
        let rawHistory = await getRecentWebChats(sessionId);
        let history = formatChatHistoryForIntent(rawHistory);
        history = history || [];
        history.push({
          role: "user",
          content: userText,
        });
        const userquestion = userText;
        return { rawHistory , history , sessionId , userquestion };
      });
    }
    getIntentWithContext({ systemPrompts, instructions = [], functions }) {
      return this.chain(async function (parentResp) {
        const userText = $.inbound.getText();
        let rawHistory = await getRecentWebChats(sessionId);
        let history = formatChatHistoryForIntent(rawHistory);
        history = history || [];
        history.push({
          role: "user",
          content: userText,
        });
        let prompt = await create_prompt({
          systemPrompts: systemPrompts,
          conversations: history,
          instructions: instructions,
        });
        let resp = await $.openai({ useGlobalConfig: true , parameters : { model : "gpt-4o-mini" , temperature : 0 , max_tokens : 300 }}).next(prompt, functions);
        return {
          history,
          rawHistory,
          sessionId,
          function_call: function (...args) {
            return resp.function_call(...args);
          },
          message(...args) {
            return resp.message(...args);
          },
          userText,
        };
      });
    }
    markDownToWhatsAppFormatter(answer){
      return this.chain(async function(parentResp){
        const formatted_answer = convertMarkdownToWhatsApp(answer);
        return formatted_answer;
      })
    }
    rephrase(message) {
      return this.chain(async function (parentResp) {
        console.log(`message in dorag snippet: ${JSON.stringify(message)}`);
        // const { rephrase_system_prompt, rephrase_user_prompt } = await $.app.options.custom();
        const { rephrasing_rules, rephrasing_conflict_resolution_rules, rephrasing_examples } =
          await $.app.options.custom();
        const rephrasedQuestion = await rephraseWithContext({
          currentQuestion: message.userquestion,
          rawHistory: message.rawHistory,
          rephrasingRules: rephrasing_rules,
          rephrasingConflict: rephrasing_conflict_resolution_rules,
          rephrasingExamples: rephrasing_examples,
        });
        console.log(`rephrased question : ${rephrasedQuestion}`);
        return rephrasedQuestion;
      });
    }
    rag(rephrasedQuestion) {
      return this.chain(async function (parentResp) {
        const tenant_partition_key = context.getTenant()
        const topMatches = await performRag(rephrasedQuestion , tenant_partition_key);
        return topMatches;
      });
    }
    rephraseWithRag({ userquestion, rawHistory, rephrasingRules, rephrasingConflict, rephrasingExamples }) {
      return this.chain(async function (parentResp) {
        const rephrasedQuestion = await rephraseWithContext({
          currentQuestion: userquestion,
          rawHistory: rawHistory,
          rephrasingRules,
          rephrasingConflict,
          rephrasingExamples,
        });
        console.log(`rephrased question : ${rephrasedQuestion}`);
        // const tenant_partition_key = context.getTenant()
        const tenant_partition_key = MRY_SCRIPTUS_DOMAIN || context.getTenant();
        const topMatches = await performRag(rephrasedQuestion , tenant_partition_key);

        let relevantInfo = "";
        const matches = [];
        // console.log(`topmatches : ${JSON.stringify(topMatches)}`);
        for (let i = 0; i < topMatches.length; i++) {
          const newInfo = `${i + 1}. ${topMatches[i].knowledgebase} \n`;
          matches.push({ knowledgebase: newInfo, score: topMatches[i].score });
          relevantInfo += newInfo;
        }
        return { rephrasedQuestion, relevantInfo, matches };
      });
    }
    askllm({ botIntroduction, relevantInfo, rephrasedQuestion, noInfoResponse, sys_prompt, user_prompt, model }) {
      return this.chain(async function (parentResp) {
        const answer = await getModelResponse({
          relevantInfo: relevantInfo,
          rephrasedQuestion: rephrasedQuestion,
          botIntroduction: botIntroduction,
          model: model,
          noInfoResponse: noInfoResponse || information_not_available(),
          sys_prompt : sys_prompt,
          user_prompt : user_prompt
        });
        return answer;
      });
    }
    saveConvo(convo) {
      return this.chain(async function (parentResp) {
        return await saveConversation(convo);
      });
    }
  }
  return function () {
    //EVERY TIME FUNCTION IS CALLED
    // SCOPE : FUNCTION
    return new DoRagPromise();
  };
};
