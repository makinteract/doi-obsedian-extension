const input = document.getElementById('doi');
const button = document.getElementById('generate');
const statusEl = document.getElementById('status');
const itemsEl = document.getElementById('items');
const addCurrentButton = document.getElementById('addCurrent');
const apiKeyInput = document.getElementById('apiKey');
const settingsEl = document.getElementById('settings');
const aiSummaryCheckbox = document.getElementById('aiSummary');

// The key lives in the extension's localStorage, never in the source files
function loadApiKey() {
  try {
    return localStorage.getItem('openaiApiKey') || '';
  } catch (_) {
    return '';
  }
}

// Remember the AI summary choice between popup openings (checked by default)
try {
  aiSummaryCheckbox.checked = localStorage.getItem('aiSummary') !== 'false';
} catch (_) {}
aiSummaryCheckbox.addEventListener('change', () => {
  try {
    localStorage.setItem('aiSummary', String(aiSummaryCheckbox.checked));
  } catch (_) {}
});

apiKeyInput.value = loadApiKey();
if (!apiKeyInput.value) settingsEl.open = true;
apiKeyInput.addEventListener('change', () => {
  try {
    localStorage.setItem('openaiApiKey', apiKeyInput.value.trim());
  } catch (_) {
    setStatus('Could not save the API key.', true);
  }
});

const DOI_REGEX = /10\.\d{4,9}\/[^\s?#&"'<>]+/i;

function extractDoi(text) {
  if (!text) return null;
  let decoded = text;
  try { decoded = decodeURIComponent(text); } catch (_) {}
  const match = decoded.match(DOI_REGEX);
  if (!match) return null;
  // Strip trailing punctuation and common URL suffixes (e.g. /pdf, /full)
  return match[0]
    .replace(/[.,;:)\]]+$/, '')
    .replace(/\/(pdf|full|abstract|epdf|fulltext)$/i, '');
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
}

// Read a DOI from the page's citation meta tags (most publisher pages have one)
async function doiFromPageMeta(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const names = ['citation_doi', 'dc.identifier', 'dc.Identifier', 'prism.doi', 'bepress_citation_doi'];
        for (const name of names) {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          if (el?.content) return el.content;
        }
        return null;
      }
    });
    return extractDoi(result);
  } catch (_) {
    // Restricted pages (chrome://, Web Store, etc.) can't be scripted
    return null;
  }
}

// Add the current page: DOI from the URL, then from meta tags, else the raw URL
addCurrentButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const doi = extractDoi(tab.url) || await doiFromPageMeta(tab.id);
  const entry = doi || (/^https?:/i.test(tab.url) ? tab.url : null);
  if (!entry) {
    setStatus('No DOI or URL on this page.', true);
    return;
  }

  const existing = input.value.split(/\s+/).filter(Boolean);
  if (existing.includes(entry)) {
    setStatus('Current page is already in the list.');
    return;
  }
  input.value = [...existing, entry].join('\n');
  setStatus(doi ? 'DOI found in current page.' : 'No DOI found; added the page URL.', !doi);
  renderItems();
});

// One entry per line (or whitespace-separated token), deduplicated by DOI
function parseEntries() {
  const seen = new Set();
  return input.value
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, doi: extractDoi(text) }))
    .filter(({ text, doi }) => {
      const key = doi ? doi.toLowerCase() : text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function removeEntry(text) {
  input.value = input.value
    .split(/\s+/)
    .filter((t) => t && t !== text)
    .join('\n');
  renderItems();
}

function renderItems() {
  itemsEl.replaceChildren();
  for (const entry of parseEntries()) {
    const badge = document.createElement('span');
    badge.className = 'badge' + (entry.doi ? '' : ' invalid');
    badge.title = entry.doi ? entry.text : `No DOI found in: ${entry.text}`;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.doi || entry.text;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => removeEntry(entry.text));

    badge.append(label, remove);
    itemsEl.append(badge);
  }
  return [...itemsEl.children];
}

input.addEventListener('input', renderItems);

function setBadgeState(badge, state, title) {
  badge.className = 'badge ' + state;
  if (title) badge.title = title;
}

let running = null;

chrome.runtime.onMessage.addListener((message) => {
  if (!running) return;
  if (message.type === 'progress') {
    const badge = running.badges.get(message.doi.toLowerCase());
    if (!badge) return;
    const tips = { done: 'Downloaded', warn: `Downloaded without AI summary. ${message.error}`, error: `Error: ${message.error}` };
    setBadgeState(badge, message.state, tips[message.state]);
    if (message.state === 'warn') running.warned++;
    if (message.state === 'working') {
      running.index++;
      setStatus(`Fetching ${running.index} of ${running.badges.size}…`);
    }
  } else if (message.type === 'finished') {
    const { done, failed, total } = message;
    setStatus(
      `Downloaded ${done} of ${total}.` +
        (failed ? ` ${failed} failed (hover a red badge for details).` : '') +
        (running.warned ? ` ${running.warned} without AI summary (hover an orange badge).` : '') +
        (running.skipped ? ` ${running.skipped} skipped (no DOI).` : ''),
      failed > 0
    );
    running = null;
    button.disabled = false;
    input.disabled = false;
    aiSummaryCheckbox.disabled = false;
    addCurrentButton.disabled = false;
    itemsEl.inert = false;
  }
});

button.addEventListener('click', () => {
  const entries = parseEntries();
  const badgeEls = renderItems();
  const badges = new Map();
  entries.forEach((e, i) => {
    if (e.doi) badges.set(e.doi.toLowerCase(), badgeEls[i]);
  });
  if (!badges.size) {
    setStatus('No valid DOI found.', true);
    return;
  }

  if (aiSummaryCheckbox.checked && !loadApiKey()) {
    settingsEl.open = true;
    apiKeyInput.focus();
    setStatus('Add an OpenAI API key in Settings, or uncheck AI summary.', true);
    return;
  }

  running = { badges, index: 0, warned: 0, skipped: entries.length - badges.size };
  button.disabled = true;
  input.disabled = true;
  aiSummaryCheckbox.disabled = true;
  addCurrentButton.disabled = true;
  itemsEl.inert = true;
  setStatus('Starting…');
  chrome.runtime.sendMessage({ type: 'generate', apiKey: aiSummaryCheckbox.checked ? loadApiKey() : '', dois: entries.filter((e) => e.doi).map((e) => e.doi) });
});
