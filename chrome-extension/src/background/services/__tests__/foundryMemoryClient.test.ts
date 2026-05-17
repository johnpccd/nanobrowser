import { describe, expect, it } from 'vitest';
import { buildUserMessageItem, formatMemoryOperationError, parseMemoryStoreRecord } from '../foundryMemoryClient';

describe('foundryMemoryClient', () => {
  it('parseMemoryStoreRecord reads chat and embedding models from definition', () => {
    const store = parseMemoryStoreRecord({
      name: 'my_store',
      id: 'ms_1',
      definition: {
        kind: 'default',
        chat_model: 'gpt-5.4-mini',
        embedding_model: 'text-embedding-3-small',
      },
    });
    expect(store).toEqual({
      name: 'my_store',
      id: 'ms_1',
      description: undefined,
      chatModel: 'gpt-5.4-mini',
      embeddingModel: 'text-embedding-3-small',
    });
  });

  it('buildUserMessageItem matches REST shape', () => {
    expect(buildUserMessageItem('hello')).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    });
  });

  it('formatMemoryOperationError surfaces deployment auth failures', () => {
    const message = formatMemoryOperationError({
      status: 'failed',
      error: {
        message: 'Provided Azure resource encountered an error.',
        details: {
          type: 'Authentication',
          status_code: 401,
          deployment: '620e7ce777774d83b14f4f70f07080e0/deployments/gpt-5.4-mini',
          description: 'Authentication to the Azure OpenAI resource failed.',
        },
      },
    });
    expect(message).toContain('gpt-5.4-mini');
    expect(message).toContain('managed identity');
  });
});
