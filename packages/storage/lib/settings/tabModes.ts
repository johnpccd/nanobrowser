import { StorageEnum } from '../base/enums';

export type TabMode = 'automation' | 'qa';

/**
 * Get the mode for a specific tab
 * @param tabId - The tab ID
 * @returns The mode for the tab, or 'automation' if not set
 */
export async function getTabMode(tabId: number): Promise<TabMode> {
  const key = `tab-mode-${tabId}`;
  const result = await chrome.storage.local.get([key]);
  return (result[key] as TabMode) || 'automation';
}

/**
 * Set the mode for a specific tab
 * @param tabId - The tab ID
 * @param mode - The mode to set
 */
export async function setTabMode(tabId: number, mode: TabMode): Promise<void> {
  const key = `tab-mode-${tabId}`;
  await chrome.storage.local.set({ [key]: mode });
}

/**
 * Clear the mode for a specific tab
 * @param tabId - The tab ID
 */
export async function clearTabMode(tabId: number): Promise<void> {
  const key = `tab-mode-${tabId}`;
  await chrome.storage.local.remove([key]);
}

/**
 * Get the active session ID for a specific tab
 * @param tabId - The tab ID
 * @returns The active session ID, or null if not set
 */
export async function getTabActiveSession(tabId: number): Promise<string | null> {
  const key = `tab-active-session-${tabId}`;
  const result = await chrome.storage.local.get([key]);
  return result[key] || null;
}

/**
 * Set the active session ID for a specific tab
 * @param tabId - The tab ID
 * @param sessionId - The session ID to set, or null to clear
 */
export async function setTabActiveSession(tabId: number, sessionId: string | null): Promise<void> {
  const key = `tab-active-session-${tabId}`;
  if (sessionId === null) {
    await chrome.storage.local.remove([key]);
  } else {
    await chrome.storage.local.set({ [key]: sessionId });
  }
}

/**
 * Clear the active session for a specific tab
 * @param tabId - The tab ID
 */
export async function clearTabActiveSession(tabId: number): Promise<void> {
  const key = `tab-active-session-${tabId}`;
  await chrome.storage.local.remove([key]);
}

/**
 * Clear all state for a specific tab (mode and active session)
 * @param tabId - The tab ID
 */
export async function clearTabState(tabId: number): Promise<void> {
  await Promise.all([clearTabMode(tabId), clearTabActiveSession(tabId)]);
}
