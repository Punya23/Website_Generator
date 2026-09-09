# Placements — content map for the real-estate templates

Each of the four templates in this folder (`real-estate-agency/`, `luxury-real-estate/`,
`commercial-real-estate/`, `property-management/`) ships two generated files:

- **`placements.llm.json`** — **the file for your orchestration to attach to an LLM call.** Nested
  page → section → field, so "does the nav bar ever need anything?" and "what does the hero
  section need?" are answered by looking, not by reading code. Every field says `editable`
  true/false; a locked field says why. This is the deliverable — reviewable, diffable, made once
  per template.
- `placements.json` — the internal map underneath it (CSS selectors, constraint math, composition
  rules). Not meant for a model's eyes; `placements.llm.json` is derived from it.

**The point of both: an LLM never sees the HTML.** It sees a filtered slice of `placements.llm.json`
(see "The LLM contract" below) and answers with plain values in the same nested shape. A separate,
deterministic step (`fill.ts`) writes those values into the real markup by CSS selector, enforcing
every constraint on the way in. A model's answer can be too long, too short, or badly worded — it
can never corrupt the page, because it never touches the page.

```
 real-estate-map.ts       extract.ts              placements.json         llm-view.ts
 (selectors, roles,  ──▶  (reads the real   ──▶   (internal map,    ──▶   buildLlmView
  hand-authored           HTML, resolves         checked into              (nested by
  once, shared by         each selector,         the repo)                 page → section →
  all 4 templates)        measures a char/                                 field, editable
                          word budget)                                     true/false)
                                                                                 │
                                                                                 ▼
                                                                       placements.llm.json
                                                                       (attach this to
                                                                        an LLM call)
                                                                                 │
                                                              buildPromptPayload │  (strip to
                                                                                 │   editable-only,
                                                                                 ▼   no internal ids)
                                                                    an LLM (OpenRouter, etc.)
                                                                                 │
                                                             applyLlmResponse    │  (back to real
                                                                                 ▼   placement ids)
                                                                    fill.ts's applyPlacements
                                                                    (clamps every value, writes
                                                                     it into the real HTML)
```

## Regenerating

```bash
npm run templates:placements:real-estate
```

Writes both files for all four templates. Deterministic and safe to re-run any time
`src/templates/placements/real-estate-map.ts` or a template's own HTML/CSS changes. A selector that
stops resolving to exactly one element (a typo, or a template that has drifted from the shared
shape) fails the run loudly instead of silently shipping a wrong or empty map — see
`src/templates/placements/extract.ts`.

## `placements.llm.json` — the shape your orchestration reads

```jsonc
{
  "template": "real-estate-agency",
  "pages": {
    "chrome": {
      "sections": {
        "nav": {
          "fields": {
            "brand": { "id": "chrome.nav.brand", "type": "text", "editable": false,
                       "current": "PrestigeRealty", "reason": "comes from the business's own profile, not the model" }
          },
          "instances": [
            { "text": { "id": "chrome.nav.link.0", "type": "text", "editable": false,
                        "current": "Home", "reason": "structural/UI text — never rewritten" } },
            { "text": { "id": "chrome.nav.link.1", "type": "text", "editable": false, "current": "About", "...": "" } }
            /* ...4 more — the whole nav bar is locked, every field editable:false */
          ]
        },
        "navCta": {
          "fields": {
            "cta": { "id": "chrome.nav.cta", "type": "text", "editable": true,
                     "current": "Get a Free Valuation", "minChars": 10, "maxChars": 40 }
          }
        }
      }
    },
    "index.html": {
      "sections": {
        "hero": {
          "fields": {
            "eyebrow":  { "id": "home.hero.eyebrow",  "type": "text", "editable": true, "current": "Bay Area Real Estate", "minChars": 10, "maxChars": 32 },
            "title":    { "id": "home.hero.title",    "type": "text", "editable": true, "current": "Find the home that fits your next chapter", "minChars": 16, "maxChars": 54 },
            "subtitle": { "id": "home.hero.subtitle", "type": "text", "editable": true, "current": "Prestige Realty has guided...", "minChars": 68, "maxChars": 183 },
            "background": { "id": "home.hero.background", "type": "image", "editable": false, "current": "https://...", "reason": "a specific real fact ... comes from the business's own data, never invented" }
          },
          "instances": [
            { "text": { "id": "home.hero.cta.0", "type": "text", "editable": true, "current": "Browse Listings", "minChars": 8, "maxChars": 24 } },
            { "text": { "id": "home.hero.cta.1", "type": "text", "editable": true, "current": "Talk to an Agent", "minChars": 8, "maxChars": 24 } }
          ]
        },
        "featuredListings": { "...": "a section__eyebrow/title (fields) + 6 property cards (instances), each card's price/location/beds/baths/sqft/badge/photo editable:false, title editable:true" }
      }
    }
    /* ...about.html, services.html, listings.html, property-detail.html, agents.html, agent-detail.html, contact.html */
  }
}
```

**This is what "the nav bar never needs to change" looks like as data**: every field in `nav` —
the brand name and all six links — is `"editable": false`, each with a `reason`. `hero` and
`featuredListings`, by contrast, are mostly `editable: true` fields. Your orchestration reads this
file, sees which sections have anything editable at all, and only sends those on.

A **field** (singular, e.g. `hero.title`) or a slot in an **instance** array (repeated things — nav
links, property cards, FAQ items, testimonials) both carry the same shape:

```jsonc
{
  "id": "home.hero.title",     // internal — resolves this value back to the real DOM node. Stripped before the model sees it.
  "type": "text",              // or "image"
  "editable": true,
  "current": "Find the home that fits your next chapter",  // reference: length/style, or (locked) the value that ships as-is
  "minChars": 16, "maxChars": 54,           // text only, only when editable
  "aspectRatio": "16:9", "minWidthPx": 1600, "subject": "...",  // image only, only when editable
  "reason": "..."              // only when NOT editable — why
}
```

## The LLM contract

**`buildPromptPayload(view)`** strips `placements.llm.json` down to exactly what a model should
see: only `editable: true` fields, and none of the bookkeeping (`id`, `editable`, `reason`) — this,
and only this, is what actually goes to OpenRouter. A section with nothing editable (`nav`,
`footerQuickLinks`) is dropped from the payload entirely, not just marked locked — for the real
template, that shrinks the file from ~98KB to ~18KB.

```jsonc
// what OpenRouter actually receives for the hero section
"hero": {
  "fields": {
    "eyebrow":  { "type": "text", "current": "Bay Area Real Estate", "minChars": 10, "maxChars": 32 },
    "title":    { "type": "text", "current": "Find the home that fits your next chapter", "minChars": 16, "maxChars": 54 },
    "subtitle": { "type": "text", "current": "Prestige Realty has guided...", "minChars": 68, "maxChars": 183 }
  },
  "instances": [
    { "text": { "type": "text", "current": "Browse Listings", "minChars": 8, "maxChars": 24 } },
    { "text": { "type": "text", "current": "Talk to an Agent", "minChars": 8, "maxChars": 24 } }
  ]
}
```

Ask the model to return the **same shape back**, values swapped in for the field objects:

```jsonc
"hero": {
  "fields": { "eyebrow": "Coastal Bay Homes", "title": "Homes that fit your next chapter, found faster",
              "subtitle": "Local expertise, honest advice, and access to homes before they hit the open market." },
  "instances": [ { "text": "See Listings" }, { "text": "Talk to an Agent" } ]
}
```

For an `image` field, the value is a short plain-English stock-photo search query (e.g. `"modern
suburban home exterior dusk"`), not a URL — resolve it through your own stock-photo provider before
handing the result to `applyPlacements`.

**Recommended in practice: the flat variant.** `buildFlatPromptPayload(page)` /
`applyFlatLlmResponse(view, response)` do the identical job but key every editable field by its real
placement id instead of nesting it under page/section/instance — `{"home.hero.title": {"current":
"...", "maxChars": 54}, ...}` in, `{"values": {"home.hero.title": "..."}}` back. Confirmed live
against `google/gemini-3.5-flash-lite`: asked to preserve the nested shape exactly, the same page/
prompt/model sometimes came back with entire sections silently missing — valid JSON, wrong shape, no
parse error to catch it. Flat key→value completion doesn't give a model anywhere to drop a nested
array or rename a wrapper key; a real run against all 8 pages went from as low as ~75% field
coverage (nested) to 135/135 (100%, flat) with zero prompt/model changes otherwise. `scripts/
generate-real-site.ts` uses the flat variant for exactly this reason — treat it as the default,
and keep the nested one for what it's actually good at: a human (or your orchestration's own
"does this section need anything" check) reading `placements.llm.json`.

**`applyLlmResponse(view, response)`** takes that answer back (same nested shape, against the
FULL `view` — not the stripped prompt) and resolves every value to its real placement id, ready for
`fill.ts`. A value offered for a path that doesn't exist, or a field the view marks non-editable, is
silently dropped — the model literally cannot touch `nav` even if it tries.

## Applying the result

```ts
import fs from "node:fs/promises";
import { PlacementsFileSchema } from "../src/templates/placements/schema.js";
import { buildLlmView, buildPromptPayload, applyLlmResponse } from "../src/templates/placements/llm-view.js";
import { applyPlacements } from "../src/templates/placements/fill.js";

const file = PlacementsFileSchema.parse(JSON.parse(await fs.readFile("real-estate/real-estate-agency/placements.json", "utf8")));
const view = buildLlmView(file);                    // or read placements.llm.json directly — same shape
const prompt = buildPromptPayload(view);             // <- send this to OpenRouter

const modelReply = await callOpenRouter(prompt);     // your own call — same nested shape back
const llmValues = applyLlmResponse(view, modelReply); // -> { "home.hero.title": "...", ... }

const html = await fs.readFile("real-estate/real-estate-agency/index.html", "utf8");
const chrome = file.pages.chrome;
const page = file.pages["index.html"];
const merged = { page: "index.html", text: [...chrome.text, ...page.text], images: [...chrome.images, ...page.images] };

const result = await applyPlacements(html, merged, {
  brief: { businessName: "Bay Breeze Realty", phone: "(415) 555-0100", /* ... */ },
  resolveData: async (placement) => lookupFromYourOwnListingsOrRoster(placement), // `data` placements
  llmValues,                                                                     // `llm`/`llmQuery` placements
});

await fs.writeFile("dist/index.html", result.html, "utf8");
console.log(result.clamped);       // every value that got truncated or rejected, and why
console.log(result.rejectedFixed); // any locked placement a caller mistakenly supplied a value for
```

`applyPlacements` never throws on a bad or missing value — a placement it cannot resolve simply
keeps the template's own original copy, which is always a safe, complete page. See
`scripts/demo-placements-fill.ts` for a runnable version of this exact round trip (with a
synthesized adversarial "model reply" standing in for a real OpenRouter call), and
`tests/placements.test.ts` for the automated version.

## Everything under the hood (`placements.json`, `fill.ts`) — why each choice

You don't need this section to use the pipeline; it's here for anyone extending it.

### `fillSource` — who's allowed to write this placement, and why (`editable` in the LLM view is `fillSource === "llm" | "llmQuery"`)

| `fillSource` | Comes from | Why |
|---|---|---|
| `fixed` | nobody — always the template's own text | Pure UI mechanics ("Search", "Join", form field labels, **site navigation**). No brand-voice value, no reason to ever change it. |
| `brief` | the business's own profile (name, phone, email, address, license number, hours) | Never invented. |
| `data` | the business's own records (a listing's price/address, an agent's name/photo, a real customer testimonial, a business stat) — falls back to the template's own (clearly fictional) demo value when no record exists yet | Fabricating a specific price, street address, or customer quote is a **trust problem**, not a copy-quality one. Same line `src/templates/copy-slots.ts` already draws around testimonials and team photos for this project's scraped-template corpus, generalized here to every specific factual claim a real-estate site makes. |
| `llm` | a model, bounded by `constraints` | Genuine marketing prose — headlines, section copy, a plausible property description when no real listing feed exists yet. |
| `llmQuery` (images only) | a model supplies a short stock-photo search query, never a URL | Mirrors `src/agents/verbatim-media-agent.ts`'s existing pattern for the scraped-template corpus. |

Site navigation (`nav.link.*`, the footer's mirrored quick-links) is `fixed`, full stop — it names a
real page, so its wording isn't a model's to vary. A footer's *category* list (property types,
service areas — genuinely different per business) stays `llm`, tightly word-capped.

### `section` — how grouping is computed

`real-estate-map.ts`'s `sectionForId` maps an id (`"home.featured.0.title"`) to its section
(`"featuredListings"`) via a lookup table, not a live field on every descriptor — every id already
begins with the string chosen for its group, so this costs one small table instead of touching
~450 descriptor literals.

### `constraints` — how the numbers are derived

`minChars`/`maxChars` come from the box's own real typography (font-size, line-height) and width,
read off the shared stylesheet (`src/templates/placements/measure.ts`), anchored so the ceiling is
never below the length of the copy already shipping there today — that copy is proof the box can
hold at least that much. A short label (a nav link, a badge) uses a plain word-count cap instead of
the geometric estimate — "does it read as a label" matters more than pixel-fit for text that short.

### `compose` — a few spots need a template literal, not the raw value

Four roles compose a value from a fixed piece of text plus one or two brief fields, instead of
substituting a field verbatim — see `fill.ts`'s `composedValue`:

- `footerCopyright` → `"© <current year> <businessName>. All rights reserved."`
- `footerLicense` → the license number followed by the original's own `" · "` separator (the two
  legal links after it are preserved untouched — see `preserveChildren` below)
- `callButton` → `"Call <phone>"`
- `phoneAndEmail` → `"<phone><br><email>"` (the one case that needs actual markup, not plain text)

### `preserveChildren`

When true, `fill.ts` replaces only the element's own direct text node(s) and leaves every element
child untouched. Used for the two spots where a functional child sits next to substitutable text: the
FAQ accordion's `+`/`−` toggle icon, and the footer's two legal links next to the license number.
Everywhere else, a placement's whole element is replaced with plain text — correct by construction
for any LLM-sourced value, which never carries markup to begin with. The one accepted cost: a purely
decorative inline accent (the `<em>`-emphasized word in a hero headline, the two-tone brand-name
span) does not survive a rewrite.

## What's intentionally left out

Live UI state and pure interaction mechanics are not placements at all — there is nothing for a
business, a model, or a data feed to say about them: the listings-page filter/sort controls, the
"Showing 9 of 142" results count, pagination numbers, dropdown option lists, and demo form
placeholder text.

## Known limitations

- Constraint math is a closed-form estimate from the stylesheet's own numbers (`measure.ts`), not a
  real layout pass — it will occasionally be conservative or generous by a few characters. It cannot
  make a page overflow the way skipping constraints entirely would.
- No real listings/roster/testimonial data source exists in this codebase yet — `data`-sourced
  placements are wired to accept one (`ApplyPlacementsOptions.resolveData`) but every example in this
  repo falls back to the template's own demo content until a real feed is connected.
- `footerLicense`'s composition assumes the exact `" · "` separator the four templates in this folder
  already use; a future template with different punctuation around its license number would need its
  own `compose` case.
