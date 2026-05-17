import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';

/** Maps QA chat session id → Foundry conversation id (conv_…). */
const storage = createStorage<Record<string, string>>(
  'foundry-conversation-ids',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: false,
  },
);

export const foundryConversationStore = {
  async getConversationId(sessionId: string): Promise<string | undefined> {
    const map = await storage.get();
    const id = map?.[sessionId.trim()];
    return id?.trim() || undefined;
  },
  async setConversationId(sessionId: string, conversationId: string): Promise<void> {
    const key = sessionId.trim();
    const value = conversationId.trim();
    if (!key || !value) {
      return;
    }
    const map = { ...(await storage.get()), [key]: value };
    await storage.set(map);
  },
  async removeConversationId(sessionId: string): Promise<void> {
    const key = sessionId.trim();
    const map = { ...(await storage.get()) };
    delete map[key];
    await storage.set(map);
  },
};
