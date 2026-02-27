const state = {
  tabs: [],
  filter: '',
  duplicateUrlCounts: new Map(),
};

const elements = {
  searchInput: document.getElementById('searchInput'),
  tabsContainer: document.getElementById('tabsContainer'),
  saveSessionBtn: document.getElementById('saveSessionBtn'),
  sessionsContainer: document.getElementById('sessionsContainer'),
  tabItemTemplate: document.getElementById('tabItemTemplate'),
  autoSuspendToggle: document.getElementById('autoSuspendToggle'),
};

/** Bootstraps popup event handlers and initial data fetches. */
async function init() {
  elements.searchInput.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderTabs();
  });

  elements.saveSessionBtn.addEventListener('click', saveCurrentSession);
  elements.autoSuspendToggle.addEventListener('change', toggleAutoSuspend);

  await Promise.all([refreshTabs(), renderSavedSessions(), loadAutoSuspendSetting()]);
}

/** Queries currently open tabs and computes duplicate URL metadata. */
async function refreshTabs() {
  state.tabs = await chrome.tabs.query({});
  state.duplicateUrlCounts = countDuplicateUrls(state.tabs);
  renderTabs();
}

/** Returns URL counts for duplicate detection. */
function countDuplicateUrls(tabs) {
  const counts = new Map();
  tabs.forEach((tab) => {
    if (!tab.url) return;
    counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
  });
  return counts;
}

/** Filters tabs based on title/URL and renders groups by domain. */
function renderTabs() {
  const filteredTabs = state.tabs.filter((tab) => {
    const haystack = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
    return haystack.includes(state.filter);
  });

  const grouped = groupTabsByDomain(filteredTabs);
  elements.tabsContainer.textContent = '';

  Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([domain, tabs]) => {
      const groupElement = document.createElement('section');
      groupElement.className = 'group';

      const header = document.createElement('h3');
      header.className = 'group-header';
      header.textContent = `${domain} (${tabs.length})`;

      const closeDuplicatesBtn = document.createElement('button');
      closeDuplicatesBtn.textContent = 'Close duplicates in group';
      closeDuplicatesBtn.addEventListener('click', () => closeDuplicateTabs(tabs));

      const list = document.createElement('div');
      list.className = 'tab-list';

      tabs.forEach((tab) => {
        list.appendChild(createTabItem(tab));
      });

      groupElement.append(header, closeDuplicatesBtn, list);
      elements.tabsContainer.appendChild(groupElement);
    });
}

/** Groups tabs by domain for easier browsing in the popup. */
function groupTabsByDomain(tabs) {
  return tabs.reduce((acc, tab) => {
    const domain = getDomainFromUrl(tab.url);
    if (!acc[domain]) acc[domain] = [];
    acc[domain].push(tab);
    return acc;
  }, {});
}

/** Normalizes URL into hostname and provides a fallback label. */
function getDomainFromUrl(url) {
  if (!url) return 'Unknown';
  try {
    return new URL(url).hostname || 'Unknown';
  } catch {
    return 'Browser Page';
  }
}

/** Creates a tab row with pin/unpin and close actions. */
function createTabItem(tab) {
  const fragment = elements.tabItemTemplate.content.cloneNode(true);
  const item = fragment.querySelector('.tab-item');

  fragment.querySelector('.title').textContent = tab.title || '(Untitled Tab)';
  fragment.querySelector('.url').textContent = tab.url || '';

  const favicon = fragment.querySelector('.favicon');
  favicon.src = tab.favIconUrl || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

  const isDuplicate = Boolean(tab.url) && (state.duplicateUrlCounts.get(tab.url) || 0) > 1;
  if (isDuplicate) {
    item.classList.add('duplicate');
  }

  const pinBtn = fragment.querySelector('.pin-btn');
  pinBtn.textContent = tab.pinned ? 'Unpin' : 'Pin';
  pinBtn.addEventListener('click', async () => {
    await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    await refreshTabs();
  });

  const closeBtn = fragment.querySelector('.close-btn');
  closeBtn.addEventListener('click', async () => {
    await chrome.tabs.remove(tab.id);
    await refreshTabs();
  });

  item.addEventListener('click', async (event) => {
    if (event.target.closest('button')) return;
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  });

  return fragment;
}

/** Saves all open tabs as a session in storage.local. */
async function saveCurrentSession() {
  const tabs = await chrome.tabs.query({});
  const session = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    tabs: tabs
      .filter((tab) => tab.url && /^https?:/i.test(tab.url))
      .map((tab) => ({
        url: tab.url,
        title: tab.title || tab.url,
        pinned: Boolean(tab.pinned),
      })),
  };

  const { sessions = [] } = await chrome.storage.local.get('sessions');
  sessions.unshift(session);
  await chrome.storage.local.set({ sessions: sessions.slice(0, 25) });
  await renderSavedSessions();
}

/** Renders saved session list with restore and delete controls. */
async function renderSavedSessions() {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  elements.sessionsContainer.textContent = '';

  if (sessions.length === 0) {
    elements.sessionsContainer.textContent = 'No saved sessions yet.';
    return;
  }

  sessions.forEach((session) => {
    const item = document.createElement('article');
    item.className = 'session-item';

    const date = new Date(session.createdAt).toLocaleString();
    const info = document.createElement('span');
    info.textContent = `${date} • ${session.tabs.length} tabs`;

    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreSession(session.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.classList.add('danger');
    deleteBtn.addEventListener('click', () => deleteSession(session.id));

    const controls = document.createElement('div');
    controls.className = 'tab-actions';
    controls.append(restoreBtn, deleteBtn);

    item.append(info, controls);
    elements.sessionsContainer.appendChild(item);
  });
}

/** Re-opens all tabs from a saved session. */
async function restoreSession(sessionId) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) return;

  for (const tab of session.tabs) {
    await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
  }

  await refreshTabs();
}

/** Removes a session from storage.local. */
async function deleteSession(sessionId) {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const nextSessions = sessions.filter((entry) => entry.id !== sessionId);
  await chrome.storage.local.set({ sessions: nextSessions });
  await renderSavedSessions();
}

/** Closes duplicate URL tabs while keeping the first tab for each URL. */
async function closeDuplicateTabs(tabsInGroup) {
  const seenUrls = new Set();
  const duplicateTabIds = [];

  tabsInGroup.forEach((tab) => {
    if (!tab.url) return;
    if (seenUrls.has(tab.url)) duplicateTabIds.push(tab.id);
    seenUrls.add(tab.url);
  });

  if (duplicateTabIds.length > 0) {
    await chrome.tabs.remove(duplicateTabIds);
    await refreshTabs();
  }
}

/** Loads and reflects whether auto-suspend is enabled. */
async function loadAutoSuspendSetting() {
  const { autoSuspendEnabled = false } = await chrome.storage.local.get('autoSuspendEnabled');
  elements.autoSuspendToggle.checked = autoSuspendEnabled;
}

/** Persists auto-suspend setting to be consumed by background worker. */
async function toggleAutoSuspend(event) {
  await chrome.storage.local.set({ autoSuspendEnabled: event.target.checked });
}

chrome.tabs.onCreated.addListener(refreshTabs);
chrome.tabs.onUpdated.addListener(refreshTabs);
chrome.tabs.onRemoved.addListener(refreshTabs);
chrome.tabs.onActivated.addListener(refreshTabs);

init();
