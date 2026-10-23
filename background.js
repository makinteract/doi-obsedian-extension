const OPENAI_MODEL = 'gpt-5-mini';

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Service workers have no DOMParser, so strip the JATS/HTML markup with a regex
function stripTags(html) {
  if (!html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/^\s*abstract\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getYear(work) {
  const source = work['published-print'] || work['published-online'] || work.published || work.issued || work.created;
  return source?.['date-parts']?.[0]?.[0] ?? '';
}

function getAuthors(work) {
  return (work.author || [])
    .map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name)
    .filter(Boolean)
    .join(', ');
}

function getVenue(work) {
  return work['container-title']?.[0] || work.event?.name || work.publisher || '';
}

async function getJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch (_) {
    return null;
  }
}

// OpenAlex stores abstracts as { word: [positions] }
function fromInvertedIndex(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(' ');
}

// Crossref often has no abstract; OpenAlex and Semantic Scholar are free fallbacks
async function fetchAbstract(work, doi) {
  const fromCrossref = stripTags(work.abstract);
  if (fromCrossref) return fromCrossref;

  const openAlex = await getJson(`https://api.openalex.org/works/doi:${doi}?select=abstract_inverted_index`);
  const fromOpenAlex = fromInvertedIndex(openAlex?.abstract_inverted_index);
  if (fromOpenAlex) return fromOpenAlex;

  const s2 = await getJson(`https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=abstract`);
  return s2?.abstract?.trim() || '';
}

async function summarize(apiKey, work, abstract) {
  const paper = [
    `Title: ${work.title?.[0] ?? ''}`,
    `Authors: ${getAuthors(work)}`,
    `Venue: ${getVenue(work)} (${getYear(work)})`,
    `Abstract: ${abstract || '(not available)'}`
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You summarize research papers for a personal reading-notes vault. Reply with 2-3 markdown bullet ' +
            'points ("- "), each one short sentence of at most ~20 words: the problem, the approach, and the main ' +
            'finding. Use only the information given. If no abstract is available, give a single bullet saying what ' +
            'the title suggests the paper is about and that the abstract was unavailable. No preamble, no headings, no bold.'
        },
        { role: 'user', content: paper }
      ]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI returned ${res.status}`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned an empty summary');
  return text;
}

function buildMarkdown(work, doi, { aiSummary, abstract }) {
  const title = work.title?.[0] ?? '';
  const authors = getAuthors(work);
  const venue = getVenue(work);
  const tags = (work.subject || []).map((s) => '  - ' + s.toLowerCase().replace(/\s+/g, '-'));
  // The Summary section only exists when there is an AI summary
  const summarySection = aiSummary ? `## Summary\n\n${aiSummary}\n\n` : '';

  return `---
title: ${yamlString(title)}
authors: ${yamlString(authors)}
year: ${getYear(work)}
venue: ${yamlString(venue)}
doi: https://doi.org/${doi}
tags:${tags.length ? '\n' + tags.join('\n') : ''}
reviewed: false
relevance:
---

${summarySection}## Abstract

${abstract}

## My Notes

`;
}

function safeFilename(name) {
  return (name || 'paper').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

async function generateNote(doi, apiKey) {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!res.ok) throw new Error(`Crossref returned ${res.status}`);
  const work = (await res.json()).message;

  const abstract = await fetchAbstract(work, doi);
  let aiSummary = '';
  let warning = null;
  if (apiKey) {
    try {
      aiSummary = await summarize(apiKey, work, abstract);
    } catch (err) {
      warning = `AI summary failed: ${err.message}`;
    }
  }

  const markdown = buildMarkdown(work, doi, { aiSummary, abstract });
  const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
  await chrome.downloads.download({
    url,
    filename: safeFilename(work.title?.[0]) + '.md',
    conflictAction: 'uniquify',
    saveAs: false
  });
  return { warning };
}

function notifyPopup(message) {
  // The popup may have closed (e.g. when the download bubble opens); that's fine
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Runs in the background so the batch keeps going after the popup closes
// Service workers can't read localStorage, so the popup sends the key with each batch
async function generateAll(dois, apiKey) {
  let done = 0;
  let failed = 0;
  for (const doi of dois) {
    notifyPopup({ type: 'progress', doi, state: 'working' });
    try {
      const { warning } = await generateNote(doi, apiKey);
      done++;
      notifyPopup({ type: 'progress', doi, state: warning ? 'warn' : 'done', error: warning });
    } catch (err) {
      failed++;
      notifyPopup({ type: 'progress', doi, state: 'error', error: err.message });
    }
  }
  notifyPopup({ type: 'finished', done, failed, total: dois.length });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'generate') generateAll(message.dois, message.apiKey);
});
