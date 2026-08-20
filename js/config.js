/**
 * Static configuration: identity, storage keys, defaults and seed content.
 * Nothing here depends on the DOM or on other app modules.
 */

export const APP = Object.freeze({
  name: 'Nota',
  tagline: 'A private workspace for notes and ideas.',
  version: '1.0.0',
  repository: 'https://github.com/your-username/nota',
});

/** Bump only alongside a migration in storage.js. */
export const SCHEMA_VERSION = 1;

export const STORAGE = Object.freeze({
  dbName: 'nota-workspace',
  dbVersion: 1,
  storeName: 'app-state',
  recordKey: 'state',
  /** Mirror used by the localStorage fallback and by the pre-paint theme script. */
  fallbackKey: 'nota:state:v1',
  themeKey: 'nota:theme',
  onboardedKey: 'nota:onboarded',
});

export const TIMING = Object.freeze({
  autosaveDelay: 700,
  persistDelay: 250,
  searchDelay: 140,
  toastDuration: 4200,
});

export const LIMITS = Object.freeze({
  titleMaxLength: 200,
  tagMaxLength: 32,
  folderNameMaxLength: 60,
  excerptLength: 180,
  searchContextRadius: 48,
  maxImportBytes: 20 * 1024 * 1024,
});

/** Fixed views that are not folders. */
export const VIEWS = Object.freeze({
  all: 'all',
  favorites: 'favorites',
  pinned: 'pinned',
  archive: 'archive',
  trash: 'trash',
  folder: 'folder',
  tag: 'tag',
  search: 'search',
  settings: 'settings',
});

export const SORT_OPTIONS = Object.freeze([
  'updated-desc',
  'updated-asc',
  'created-desc',
  'title-asc',
  'title-desc',
]);

export const THEMES = Object.freeze(['system', 'light', 'dark']);
export const NOTE_VIEWS = Object.freeze(['list', 'grid']);
export const EDITOR_SIZES = Object.freeze(['small', 'medium', 'large']);
export const EDITOR_LEADINGS = Object.freeze(['compact', 'comfortable', 'spacious']);
export const DATE_FORMATS = Object.freeze(['relative', 'iso', 'long']);

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  language: 'en',
  noteView: 'list',
  sort: 'updated-desc',
  dateFormat: 'relative',
  editorFontSize: 'medium',
  lineHeight: 'comfortable',
  spellcheck: true,
});

/** Seeded on first run; ordinary folders afterwards. */
export const DEFAULT_FOLDERS = Object.freeze([
  { id: 'fld-personal', name: 'Personal', order: 0, isDefault: true },
  { id: 'fld-work', name: 'Work', order: 1, isDefault: true },
  { id: 'fld-learning', name: 'Learning', order: 2, isDefault: true },
  { id: 'fld-ideas', name: 'Ideas', order: 3, isDefault: true },
]);

/**
 * Sample notes shown after onboarding. Content is authored in the same
 * constrained subset the editor produces, so it survives sanitisation intact.
 * These are ordinary notes: the user can edit or delete every one.
 */
export const SEED_NOTES = Object.freeze([
  {
    title: 'Reading notes — Thinking in Systems',
    folderId: 'fld-learning',
    tags: ['books', 'learning'],
    isPinned: true,
    ageMinutes: 40,
    content: `<p>Meadows keeps returning to one idea: a system's behaviour comes from its structure, not from the people inside it. Blaming the operator is almost always the lazy diagnosis.</p>
<h2>Leverage points, weakest to strongest</h2>
<ol><li>Constants and parameters — the numbers everyone argues about, and the least effective place to push.</li><li>Feedback loop strength.</li><li>Information flows — who gets to see what, and when.</li><li>Rules and incentives.</li><li>Goals of the system.</li><li>The paradigm the goals arise from.</li></ol>
<blockquote>The least obvious part of the system, its function or purpose, is often the most crucial determinant of behaviour.</blockquote>
<h2>Where this applies to my work</h2>
<p>Most of our team retrospectives sit at level one — we tune numbers. The interesting question is what the delivery process is actually optimising for, which nobody has written down.</p>
<ul data-checklist="true"><li data-checked="true"><input type="checkbox" checked="checked" contenteditable="false"> Finish part two</li><li data-checked="false"><input type="checkbox" contenteditable="false"> Write up the leverage-points summary for the team wiki</li><li data-checked="false"><input type="checkbox" contenteditable="false"> Re-read the chapter on delays</li></ul>`,
  },
  {
    title: 'JavaScript: things I keep re-learning',
    folderId: 'fld-learning',
    tags: ['javascript', 'frontend'],
    isFavorite: true,
    ageMinutes: 60 * 26,
    content: `<p>A running list of the parts of the language that never quite stick the first time.</p>
<h2>Event loop order</h2>
<p>Microtasks drain completely before the next macrotask. So a <code>queueMicrotask</code> scheduled inside a promise callback still runs before any <code>setTimeout</code>, no matter how small the delay.</p>
<h2>Structured clone</h2>
<p>Browsers ship <code>structuredClone()</code> now, which handles Maps, Sets, Dates and cyclic references. It does not clone functions or DOM nodes, and it throws rather than silently dropping them.</p>
<h2>Debounce vs throttle</h2>
<ul><li><strong>Debounce</strong> — wait until the noise stops, then act once. Right for autosave and search input.</li><li><strong>Throttle</strong> — act at most once per interval. Right for scroll and resize handlers.</li></ul>
<p>Reference worth rereading: <a href="https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API">the IndexedDB API guide on MDN</a>.</p>`,
  },
  {
    title: 'Q3 planning — what I actually want to ship',
    folderId: 'fld-work',
    tags: ['important', 'ideas'],
    ageMinutes: 60 * 50,
    content: `<p>Writing this before the planning meeting so I argue from a position rather than reacting to the room.</p>
<h2>The one thing</h2>
<p>Reduce time-to-first-value. Everything else this quarter is negotiable.</p>
<h2>Proposed scope</h2>
<ul data-checklist="true"><li data-checked="false"><input type="checkbox" contenteditable="false"> Rewrite the empty states so a new account is never a blank screen</li><li data-checked="false"><input type="checkbox" contenteditable="false"> Cut onboarding from six steps to two</li><li data-checked="true"><input type="checkbox" checked="checked" contenteditable="false"> Instrument the drop-off points properly</li></ul>
<h2>What I am deliberately not doing</h2>
<p>No new integrations. We have four that nobody finished, and shipping a fifth would be an admission that we are avoiding the hard problem.</p>`,
  },
  {
    title: 'Weeknight cooking rotation',
    folderId: 'fld-personal',
    tags: ['personal'],
    ageMinutes: 60 * 74,
    content: `<p>Six things I can make without thinking, so Tuesday stops being a decision.</p>
<ul><li>White bean and rosemary soup — pantry only, 25 minutes.</li><li>Sheet-pan chicken thighs with whatever root vegetable is left.</li><li>Cacio e pepe, when the fridge is genuinely empty.</li><li>Shakshuka, which also works as a Sunday breakfast.</li><li>Rice bowl with a jammy egg and last night's leftovers.</li><li>Lentil dal, doubled and frozen in halves.</li></ul>
<p>Rule: if a recipe needs more than one pan on a weeknight, it is a weekend recipe.</p>`,
  },
  {
    title: 'Idea: a reading log that is not a spreadsheet',
    folderId: 'fld-ideas',
    tags: ['ideas', 'books'],
    ageMinutes: 60 * 120,
    content: `<p>Every reading tracker I have tried turns into data entry. The interesting artefact is not the list of titles — it is the sentence you wrote three months later that shows what actually stayed with you.</p>
<h2>Shape</h2>
<p>One entry per book. Two required fields: what it argued, and what you now think. Star ratings deliberately omitted.</p>
<h2>Open questions</h2>
<ul><li>Does it need a "currently reading" state, or is that just anxiety with a progress bar?</li><li>Import from a plain text file, or nothing at all?</li></ul>
<p>Park this until the quarter ends, but the two-field constraint is the good part.</p>`,
  },
]);
