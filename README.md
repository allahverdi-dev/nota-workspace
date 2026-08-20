# Nota

**A private, local-first workspace for notes, ideas and personal knowledge.**

Nota is a notes app that never talks to a server. Everything you write is stored
in your browser, on your device. There is no account, no sync, no analytics and
no network request after the page loads — the app works offline because it was
never online in the first place.

Built with HTML, CSS and vanilla JavaScript ES modules. No framework, no UI
library, no CSS framework, no build step.

---

## Preview

<!-- Replace with real screenshots or a short capture before publishing. -->
<!-- ![Nota — all notes, light](docs/screenshots/all-notes-light.png) -->

> **Screenshots:** _to be added._ Suggested set — desktop light, desktop dark,
> command palette, search results, settings, and the mobile list → editor pair.

**Live demo:** _to be added_ (any static host works — GitHub Pages, Netlify,
Cloudflare Pages; there is nothing to build).

---

## Features

**Writing**
- Rich text editor with headings, bold, italic, inline code, links, bulleted
  and numbered lists, checklists and quotes
- Debounced autosave with an honest status indicator — *Saving… / Saved locally
  / Save failed*
- Word count, created and updated timestamps, breadcrumbs
- Editor typography controls: font size, line height, spell check

**Organising**
- Folders (Personal, Work, Learning, Ideas by default) — create, rename, delete
- Deleting a folder never deletes notes; they move to **Unfiled**
- Tags, assignable from the editor and filterable from search
- Favourite, pin, archive
- Drag a note onto a folder in the sidebar to move it

**Finding**
- Global search across titles, content, folders and tags, with highlighted
  matches and grouped results
- Command palette (`Ctrl`/`Cmd` + `K`) for every action, view and a jump-to-note
- Sorting by updated, created or title; list and grid layouts

**Safety**
- Soft-delete trash with restore, permanent delete and empty-trash, each behind
  a confirmation
- Undo toast after moving a note to the trash
- JSON export and validated import
- Graceful behaviour when browser storage is corrupt, full or unavailable

**Everything else**
- Light, dark and system themes
- English and Azerbaijani interface
- Deep-linkable views (`#/folder/fld-work?note=note-abc`) with working back/forward
- Full keyboard operation, `prefers-reduced-motion` support, live regions
- Responsive from ~360px to wide desktop

---

## Running it locally

Nota uses ES modules, which browsers refuse to load over `file://`. It needs to
be served over HTTP — but it does **not** need to be built.

```bash
node tools/serve.mjs
```

Then open <http://localhost:4173>.

`tools/serve.mjs` is a ~60-line dependency-free static file server included for
convenience. Any equivalent works:

```bash
npx serve .
```

To deploy, upload the repository as-is to any static host. There is no
build command and no output directory.

### Tests

```bash
node tools/serve.mjs
```

Then open <http://localhost:4173/tests/>.

59 checks covering sanitisation, storage validation, routing, search and note
logic run in the browser against the real modules. The runner is ~120 lines in
`tests/runner.js` — deliberately not a framework, because adding one would mean
adding the toolchain this project exists without.

---

## Architecture

```
                    ┌──────────────┐
   user input ─────▶│   views/     │  sidebar · note-list · settings · onboarding
                    └──────┬───────┘
                           │ calls domain actions
                    ┌──────▼───────┐
                    │ notes/folders│  pure domain logic, no DOM
                    │  tags/search │
                    └──────┬───────┘
                           │ immutable updates
                    ┌──────▼───────┐
                    │    store     │  single state tree, microtask-batched
                    └──────┬───────┘
                           │ notifies changed slices
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          renderers   persistence     router
                      (storage.js)   (hash sync)
```

**State flows one way.** Views never mutate state directly; they call domain
functions, which produce a new state through the store. The store notifies
subscribers with the set of slices that changed, and each view re-renders only
if a slice it depends on is in that set. Nothing reads state out of the DOM.

**Updates are batched.** Several changes from one user action collapse into a
single render pass on the next microtask. `store.flush()` forces the pass
synchronously for the few cases that need the DOM immediately — such as putting
the caret in the title of a note that was just created.

**One sanitisation boundary.** `sanitize.js` is the only module that turns a
string into DOM. Everything else builds elements with `document.createElement`
and assigns text via `textContent`.

### Project structure

```
nota/
├── index.html          # shell + inline SVG icon sprite
├── README.md · LICENSE · .gitignore
│
├── assets/brand/       # wordmark, favicon (hand-authored SVG)
│                       # there is no assets/icons — see the sprite in index.html
│
├── css/
│   ├── tokens.css      # colours, spacing, radii, type, motion, z-index
│   ├── reset.css       # minimal, only what the app relies on
│   ├── base.css        # elements and shared primitives
│   ├── layout.css      # three-pane shell and its breakpoints
│   ├── components.css  # reusable UI: buttons, cards, menus, dialogs, toasts
│   ├── editor.css      # the writing surface
│   ├── views.css       # settings, search and onboarding composition
│   ├── utilities.css   # a handful of single-purpose helpers
│   └── responsive.css  # per-form-factor density and touch targets
│
├── js/
│   ├── app.js          # entry point and cross-module wiring
│   ├── config.js       # constants, defaults, seed content
│   ├── store.js        # state container
│   ├── storage.js      # IndexedDB / localStorage / memory + validation
│   ├── sanitize.js     # the untrusted-HTML boundary
│   ├── router.js       # hash routing
│   ├── notes.js        # note domain and selectors
│   ├── folders.js      # folder domain
│   ├── tags.js         # tag derivation
│   ├── editor.js       # contenteditable editor and autosave
│   ├── editor-format.js# selection and DOM surgery behind the toolbar
│   ├── search.js       # matching, ranking, highlighting
│   ├── commands.js     # command palette
│   ├── import-export.js
│   ├── ui.js           # toasts, dialogs, menus, focus trap, live region
│   ├── i18n.js         # message catalogue (en, az)
│   ├── utils.js        # DOM, timing, dates, text helpers
│   └── views/          # sidebar, note-list, settings, onboarding
│
├── tests/              # browser test runner and suite
└── tools/serve.mjs     # dev-only static server
```

Two deviations from a flat structure, both to keep files honest about what
they contain: `views.css` and `js/views/` hold page assembly so
`components.css` can stay about reusable primitives, and `editor-format.js`
holds the selection and DOM surgery so `editor.js` can stay about notes.

---

## Storage and privacy

**Your notes stay on this device.** Nota has no backend to send them to.

### Why IndexedDB

Notes are stored in **IndexedDB**, with automatic fallback to **localStorage**,
and finally to an in-memory object if both are blocked.

IndexedDB is the right default because it is asynchronous (a large workspace
never blocks the main thread on save), has a storage budget measured in
hundreds of megabytes rather than localStorage's ~5MB, and stores structured
values without a JSON round-trip. localStorage would be simpler, but a few
hundred notes with rich content is exactly the size where its synchronous
writes and quota start to hurt — and quota errors on a notes app mean lost
writing.

The fallback exists because IndexedDB is genuinely unavailable in some
situations: certain private-browsing modes, hardened privacy settings, and
browsers where the database open request never resolves. Rather than fail, Nota
steps down a level and tells you which mode it is in — Settings shows the
active driver, and if neither store works you get an explicit warning that
changes will not persist.

The active theme is additionally mirrored to localStorage so an inline script
can paint the right colours before the modules load, which avoids a flash of
the wrong theme.

### Data handling

- One versioned record (`schemaVersion`) holds notes, folders, tags and
  preferences. UI state is never persisted.
- Everything read back is re-validated by `normalizeState` before reaching the
  store — malformed notes are skipped, duplicate ids dropped, timestamps
  repaired, flags coerced to booleans, folder references to missing folders
  reset to Unfiled, and note content re-sanitised. Storage is treated as
  untrusted input, because an extension, a failed write or devtools can put
  anything there.
- Corrupt data does not crash the app: Nota starts from a clean workspace and
  says so.
- `migrate()` is in place for future schema versions; a record from a newer
  build is narrowed to the fields this version understands.

### What leaves your device

Nothing. Two deliberate consequences:

- **No web fonts.** The design system specifies Geist and IBM Plex Serif. Nota
  resolves to system font stacks instead, because loading them from a CDN would
  mean a request to a third party on every page load — which would contradict
  the claim on the tin. The typographic intent (a precise sans for the
  interface, a serif for the writing) is preserved with locally available faces.
- **No icon requests.** Icons are an inline SVG sprite in `index.html`.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `K` | Command palette |
| `Ctrl`/`Cmd` + `N` | New note |
| `Ctrl`/`Cmd` + `S` | Flush the pending save |
| `/` | Focus search (when not typing) |
| `Escape` | Close the topmost overlay, or the mobile sidebar |
| `↑` `↓` | Move through the notes list or palette results |
| `Enter` | Open the selected palette result |

In the editor: `Ctrl`/`Cmd` + `B` bold, `I` italic, `E` inline code, `K` link.

`Ctrl`/`Cmd` + `S` is intercepted because "save this page" is never what someone
means inside a notes app. No other browser shortcut is overridden.

---

## Accessibility

- Semantic structure: one `h1` per view, real `button`, `nav`, `main` and
  heading elements rather than clickable `div`s
- Every icon-only control has an accessible name; decorative SVG is
  `aria-hidden`
- Visible `:focus-visible` rings throughout, never suppressed without a
  replacement
- Dialogs and the command palette are modal, trap `Tab`, close on `Escape` and
  restore focus to whatever opened them
- Destructive confirmations open with focus on **Cancel**, so a stray `Enter`
  cannot delete anything
- The palette is a combobox with an owned listbox and `aria-activedescendant`,
  so the highlighted option is announced as you arrow through it
- A polite live region announces saves, theme changes and note actions
- Focus is moved with direct calls rather than `requestAnimationFrame`, so it
  still lands correctly in a background or non-painting tab
- `prefers-reduced-motion: reduce` disables animation and transitions
- Colour contrast targets WCAG AA in both themes

This has been built with care and tested by keyboard and against the
accessibility tree. It has **not** been audited by an accessibility
professional, and no conformance claim is made.

---

## Security

Note content is rich text, so it cannot be stored as a plain string — which
means untrusted HTML has to be handled properly rather than avoided.

- **One boundary.** `sanitize.js` is the only place a string becomes DOM. It
  parses into an inert document with `DOMParser` and rebuilds a fresh tree from
  an allow-list of elements and attributes. Everything else builds nodes
  programmatically.
- **Three untrusted sources**, all routed through it: what you paste, what
  `contenteditable` produces, and what an imported backup claims.
- **Links are validated**, not merely inspected: only `http:`, `https:` and
  `mailto:` survive. `javascript:`, `data:` and `blob:` are refused, including
  when hidden behind control characters. Surviving links get
  `rel="noopener noreferrer nofollow"`.
- **No `eval`**, no `Function` constructor, no inline event handlers, no
  `innerHTML` outside the sanitiser.
- **Search never builds a RegExp from your query** — matching uses folded
  substring scans, and highlights are built from text nodes and `<mark>`
  elements.
- **Imports are validated** for size, JSON validity, shape and content before
  anything is applied, and replace only after explicit confirmation.

`document.execCommand` is used for text formatting. It is deprecated, but it is
still the only rich-text implementation every engine agrees on, and everything
it produces is normalised by the sanitiser before it is stored — so the storage
format never depends on browser quirks.

---

## Responsive behaviour

| Width | Layout |
| --- | --- |
| **> 1080px** | Three panes: sidebar (260px) · notes list (340px) · editor |
| **761–1080px** | Two panes; the sidebar becomes an overlay with a scrim, reachable from the hamburger |
| **≤ 760px** | One pane at a time: notes list ↔ editor, with a back button. The formatting toolbar moves to the bottom of the screen, above the keyboard |

Mobile is designed rather than shrunk: larger touch targets, edge-to-edge cards,
full-width dialog buttons stacked with the safe action last, safe-area insets
honoured, and the palette footer hidden where it would only take up room. Tested
down to 360px with no horizontal overflow.

---

## Testing performed

Automated (`/tests/`, 59 checks): sanitisation and link safety, storage
validation and repair, tag normalisation, route round-trips, view filtering and
sorting, search matching/ranking/highlighting, and timing helpers.

Verified by hand in the browser: onboarding and seeding, note create/edit/
delete, autosave status transitions and persistence across reloads, folder
create/rename/duplicate-name validation, tags, favourite/pin/archive, trash with
undo, permanent delete and empty-trash confirmations, search with highlighting,
the command palette (keyboard navigation, filtering, `Escape`), keyboard
shortcuts, theme cycling and persistence, live language switching, export →
re-import round trip, hostile-import rejection, corrupt-storage recovery, and
the desktop, tablet and 360px layouts. The console is clean.

---

## Limitations

- **One device, one browser.** No sync, by design. Clearing browser data clears
  your notes — export regularly.
- **Formatting is deliberately small.** No tables, images, code blocks with
  syntax highlighting, or nested lists beyond what the browser produces.
  Stability was chosen over surface area.
- **Flat folders.** No nesting.
- **Search is linear**, which is fine for the thousands of notes a personal
  workspace holds and would not be for tens of thousands.
- **No undo history** inside the editor beyond the browser's own, and no note
  version history.
- `document.execCommand` is deprecated. There is no removal timeline and no
  standard replacement; if one arrives, the change is contained to `editor.js`.
- The app is not installable as a PWA and registers no service worker, so a
  first visit still requires a network connection.

## Possible next steps

- Service worker for true offline first-load and installability
- Note linking (`[[wiki style]]`) with a backlinks panel
- Full-text index for larger workspaces
- Merge-on-import, once there is a defensible conflict-resolution story
- Per-note version history built on the existing timestamps
- Encrypted export

---

## AI-Assisted Development

This project was built using an AI-assisted workflow. I want to be straightforward
about that, because the alternative — implying that every line here was typed
from memory — would be untrue.

**Tools used:** ChatGPT, Google Stitch and Claude Code.

**How the work was divided.** Google Stitch produced the initial visual
direction: screen concepts and a design system document covering the colour
roles, the dual-typeface strategy, the 8px spacing rhythm and the elevation
rules. That design system is the origin of the tokens in `css/tokens.css`. The
generated HTML itself was not used — it was Tailwind-CDN output, and the
interface here was rebuilt from scratch. ChatGPT and Claude Code were used for
implementation, refactoring and debugging.

**My role was product and engineering direction, not transcription:**

- Defining what the product is and, more importantly, what it is not — the
  fake "Pro Plan" account row, the analytics widgets and the placeholder
  "Explore" tab in the generated designs were all cut because they do not
  belong in a private notes app
- Making the architectural decisions: IndexedDB with a graceful fallback rather
  than plain localStorage, one sanitisation boundary rather than scattered
  escaping, a single state tree with declared change slices rather than views
  reading state out of the DOM
- Deciding that import replaces rather than merges, because merge needs a
  conflict story a single-device app cannot answer honestly
- Choosing system font stacks over the specified web fonts, because loading
  fonts from a CDN would contradict the privacy claim the product makes
- Reviewing, testing and debugging: the focus-after-`requestAnimationFrame` bug,
  the empty-paragraph artefacts left by `execCommand`, and the breakpoint
  collision between the sidebar toggle and the editor back button were all
  found by testing the running application, not by reading generated code
- Writing the test suite's assertions around the behaviour that actually
  matters

**What I learned building it,** and would be glad to be questioned on: how
IndexedDB transactions and versioning behave, why an allow-list sanitiser is
the only defensible approach to untrusted HTML, how the Selection and Range APIs
underpin `contenteditable`, why focus management is the hard part of accessible
dialogs, how CSS custom properties make a two-theme system a single stylesheet,
and where the CSS cascade bites when two classes contribute the same property at
equal specificity.

---

## License

[MIT](LICENSE)
