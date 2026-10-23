# DOI to Obsidian

A browser extension that turns DOIs into Obsidian-ready Markdown notes. Paste one or more DOIs or paper URLs. The extension fetches the metadata from Crossref, finds the abstract, and can add a short AI summary. It then downloads one `.md` file per paper.

## Features

- **Batch input:** paste DOIs or URLs, one per line. Duplicates are removed automatically.
- **Add current page:** the 🔗 button takes the DOI from the active tab's URL or from its citation meta tags.
- **Abstract lookup:** Crossref first, then OpenAlex and Semantic Scholar as free fallbacks.
- **Optional AI summary:** 2–3 bullets made with the OpenAI API (`gpt-5-mini`), using your own API key.
- **Keeps running in the background:** the batch continues after the popup closes.

## Installation (load unpacked)

The extension isn't on the Chrome Web Store, so you load it from this folder in developer mode. This works in Chrome and other Chromium-based browsers (Edge, Brave, Arc, Vivaldi, Opera).

1. **Get the code.** Clone or download this repository and unzip it if needed. The folder must contain `manifest.json`.
2. **Open the extensions page:**

   | Browser | Address |
   |---------|---------|
   | Chrome  | `chrome://extensions` |
   | Edge    | `edge://extensions` |
   | Brave   | `brave://extensions` |
   | Vivaldi | `vivaldi://extensions` |
   | Opera   | `opera://extensions` |
   | Arc     | Menu → Extensions → Manage Extensions |

3. **Turn on Developer mode.** Use the toggle at the top right (in Edge it's in the left sidebar).
4. **Click "Load unpacked"** and select the project folder, the one that contains `manifest.json`.
5. **Pin the extension (optional).** Click the puzzle-piece icon in the toolbar, then the pin next to **DOI to Obsidian**.

### Updating

After you pull new changes or edit the files, go back to the extensions page and click the **reload** (↻) icon on the extension's card. Then reopen the popup.

### Firefox

Not supported as-is. The manifest uses a Manifest V3 `service_worker` background, which Firefox doesn't support.

## Usage

1. Click the extension icon to open the popup.
2. Enter DOIs or URLs, one per line. For example:
   ```
   10.1145/3290605.3300233
   https://doi.org/10.1038/nature14539
   ```
   You can also open a paper's page and click 🔗 to add it. Each entry shows up as a badge. A red badge means no DOI was found in that entry.
3. *(Optional)* Turn **AI summary** on or off. To use it, open **Settings** and paste your OpenAI API key.
4. Click **Generate Obsidian files**. Badges change color as each paper is processed:
   - 🟡 working
   - 🟢 downloaded
   - 🟠 downloaded without AI summary (hover for the reason)
   - 🔴 failed (hover for the error)

The notes go to your browser's default **Downloads** folder, named after the paper title. Tip: point your browser's download location at your Obsidian vault (or an `Inbox/` folder inside it) so notes land there directly.

## Note format

```markdown
---
title: "Paper title"
authors: "Jane Doe, John Smith"
year: 2019
venue: "Journal or conference"
doi: https://doi.org/10.xxxx/xxxxx
tags:
  - subject-from-crossref
reviewed: false
relevance:
---

## Summary        ← only when an AI summary was generated

- …

## Abstract

…

## My Notes

```

## Privacy

- The OpenAI API key is kept in the extension's local storage on your machine. It is sent only to `api.openai.com`, and only when AI summary is on.
- DOIs are sent to Crossref, OpenAlex and Semantic Scholar to look up metadata. The title, authors, venue and abstract go to OpenAI only for summaries.
- Nothing is collected or sent anywhere else.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab`, `scripting` | Read the current tab's URL and citation meta tags for the 🔗 button |
| `downloads` | Save the generated `.md` files |
| Host access to Crossref, OpenAlex, Semantic Scholar, OpenAI | Fetch metadata, abstracts and summaries |

## Project structure

```
manifest.json   Extension manifest (MV3)
popup.html/js   Popup UI: input, badges, settings
background.js   Service worker: fetching, Markdown generation, downloads
icons/          Toolbar and store icons
```
