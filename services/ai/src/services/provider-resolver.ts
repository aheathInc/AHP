import { env } from '../config/env.js';
import { createOpenAiCompatibleAdapter, stubChatAdapter, type ChatAdapter } from '../adapters/chat.js';
import { stubTranscribeAdapter, type TranscribeAdapter } from '../adapters/transcribe.js';

export function resolveChatAdapter(): ChatAdapter {
  if (env.CHAT_PROVIDER === 'openai' || env.CHAT_PROVIDER === 'openai_compatible') {
    if (!env.CHAT_MODEL_KEY) {
      throw new Error('CHAT_MODEL_KEY is required when CHAT_PROVIDER=openai');
    }
    if (!env.CHAT_MODEL_ENDPOINT) {
      throw new Error('CHAT_MODEL_ENDPOINT is required for AI chat providers');
    }
    return createOpenAiCompatibleAdapter({
      modelKey: env.CHAT_MODEL_NAME,
      endpoint: env.CHAT_MODEL_ENDPOINT,
      apiKey: env.CHAT_MODEL_KEY,
      modelName: env.CHAT_MODEL_NAME,
    });
  }
  return stubChatAdapter;
}

export function resolveTranscribeAdapter(): TranscribeAdapter {
  return stubTranscribeAdapter;
}
