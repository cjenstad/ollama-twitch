import axios, { AxiosResponse } from 'axios';
import { config } from 'dotenv';
config();

interface OllamaResponse {
  response?: string;
  done?: boolean;
  message?: { role: string; content: string };
}

interface OllamaMessage {
  role: string;
  content: string;
}

// Map to store user message history
const userMessageHistory: { [username: string]: OllamaMessage[] } = {};

const date = new Date();

export async function sendStringInChunks(str: string, send: (chunk: string) => Promise<void>) {
  const chunkSize = 498;
  let index = 0;
  const delay = 3000; // 3 seconds
  console.log(`Total length to send: ${str.length}`);
  while (index < str.length) {
    const chunk = str.slice(index, index + chunkSize);
    console.log(`Sending chunk from ${index} to ${index + chunkSize}`);
    await send(chunk);
    index += chunkSize;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export async function makeOllamaRequest(prompt: string, username: string, sendChunks: (chunk: string) => Promise<void>): Promise<void> {
  const ollamaURL: string = process.env.OLLAMAURL || '127.0.0.1:11434';
  const model: string = process.env.CUSTOMMODEL || 'llama2';
  const systemPrompt: string = process.env.SYSTEMPROMPT + `Today's date is ${date}. You are talking to the chatter with the username of ${username}` || 'You are a twitch chatbot';

  if (!ollamaURL || !model) {
    throw new Error("Missing OLLAMAURL or CUSTOMMODEL in environment variables.");
  }

  const userMessage: OllamaMessage = { role: 'user', content: prompt };

  // Initialize the user's message history if it doesn't exist
  if (!userMessageHistory[username]) {
    userMessageHistory[username] = [{ role: 'system', content: systemPrompt }];
  }

  // Add the user's message to their message history
  userMessageHistory[username].push(userMessage);

  const requestData = {
    model,
    messages: userMessageHistory[username],
  };

  let fullResponse: string = '';
  return new Promise<void>(async (resolve, reject) => {
    try {
      const response: AxiosResponse = await axios.post(`http://${ollamaURL}/api/chat`, requestData, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'stream',
      });

      let assistantMessage: string = '';

      response.data.on('data', async (chunk: Buffer) => {
        const chunkString: string = chunk.toString('utf8');
        const parsed: OllamaResponse = JSON.parse(chunkString);

        if (parsed.message) {
          assistantMessage += parsed.message.content;
        }

        if (parsed.hasOwnProperty('done') && parsed.done) {
          if (assistantMessage) {
            const assistantMessageObject: OllamaMessage = { role: 'assistant', content: assistantMessage };
            userMessageHistory[username].push(assistantMessageObject);
            fullResponse = assistantMessage;
          }

          console.log("Received 'done', sending all accumulated chunks.");
          await sendStringInChunks(fullResponse, sendChunks);
          console.log("All chunks sent.");
          resolve();
        }
      });

      response.data.on('error', (err: any) => {
        reject(err);
      });
    } catch (err: any) {
      if (err instanceof Error) {
        reject(`Error: ${err.message}`);
      } else {
        reject("An unknown error occurred.");
      }
    }
    console.log(userMessageHistory[username]);
  });
}
