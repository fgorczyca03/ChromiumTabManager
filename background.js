const AUTO_SUSPEND_ALARM = 'autoSuspendTabs';
const AUTO_SUSPEND_MINUTES = 30;

/** Initializes extension defaults and starts a repeating alarm for maintenance tasks. */
chrome.runtime.onInstalled.addListener(async () => {
  const { autoSuspendEnabled } = await chrome.storage.local.get('autoSuspendEnabled');
  if (autoSuspendEnabled === undefined) {
    await chrome.storage.local.set({ autoSuspendEnabled: false });
  }

  chrome.alarms.create(AUTO_SUSPEND_ALARM, {
    periodInMinutes: 5,
  });
});

/** Responds to command shortcuts for quick tab switching and closing. */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'close-active-tab') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) await chrome.tabs.remove(activeTab.id);
  }

  if (command === 'switch-to-next-tab') {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = tabs.findIndex((tab) => tab.active);
    if (currentIndex === -1 || tabs.length === 0) return;

    const nextTab = tabs[(currentIndex + 1) % tabs.length];
    if (nextTab?.id) await chrome.tabs.update(nextTab.id, { active: true });
  }
});

/** Alarm handler: optionally auto-discards inactive tabs to reduce memory usage. */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SUSPEND_ALARM) return;

  const { autoSuspendEnabled = false } = await chrome.storage.local.get('autoSuspendEnabled');
  if (!autoSuspendEnabled) return;

  const now = Date.now();
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    const inactiveForMs = now - (tab.lastAccessed || now);
    const isCandidate =
      !tab.active &&
      !tab.pinned &&
      !tab.discarded &&
      /^https?:/i.test(tab.url || '') &&
      inactiveForMs > AUTO_SUSPEND_MINUTES * 60 * 1000;

    if (isCandidate && tab.id != null) {
      await chrome.tabs.discard(tab.id);
    }
  }
});
