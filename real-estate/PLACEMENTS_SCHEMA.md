# Placements — content map for the real-estate templates

Each of the four templates in this folder (`real-estate-agency/`, `luxury-real-estate/`,
`commercial-real-estate/`, `property-management/`) ships a generated `placements.json` — a complete
map of every editable spot in that template's HTML, with a hard length/word budget for every text
spot and a size/shape spec for every photo.

**The point of this file: an LLM never sees the HTML.** It only ever sees `placements.json` (or a
filtered subset of it — see "The LLM contract" below), and only ever answers with plain values keyed
by placement id. A separate, deterministic step (`fill.ts`) writes those values into the real markup
by CSS selector, enforcing every constraint on the way in. A model's answer can be too long, too
short, or badly worded — it can never corrupt the page, because it never touches the page.

```
   real-estate-map.ts          extract.ts                 placements.json
   (selectors + roles,    ──▶  (reads the real HTML,  ──▶  (one per template,
    hand-authored once,        resolves each selector,      checked into the repo)
    shared by all 4            measures a char/word
    templates)                 budget from the CSS)

   placements.json  ──▶  an LLM (only sees the "llm"/     ──▶  fill.ts
   (+ a brief/data          "llmQuery" placements below)        (clamps every value to
    source for the                │                               its constraints, writes
    rest)                         ▼                                it in by selector)
                          { "values": { "<id>": "<text>" } }
```

## Regenerating

```bash
npm run templates:placements:real-estate
```

Deterministic and safe to re-run any time `src/templates/placements/real-estate-map.ts` or a
template's own HTML/CSS changes. A selector that stops resolving to exactly one element (a typo, or
a template that has drifted from the shared shape) fails the run loudly instead of silently shipping
a wrong or empty map — see `src/templates/placements/extract.ts`.

## File shape

```jsonc
{
  "schemaVersion": 1,
  "vertical": "real-estate",
  "templateId": "real-estate-agency",       // the folder name
  "templateName": "Prestige Realty",        // from that template's own <title>
  "generatedAt": "2026-09-09T12:00:00.000Z",
  "pageOrder": ["index.html", "about.html", "services.html", "listings.html",
                "property-detail.html", "agents.html", "agent-detail.html", "contact.html"],
  "pages": {
    "chrome": { "page": "chrome", "text": [...], "images": [] },   // nav/topbar/footer — identical on every page
    "index.html": { "page": "index.html", "title": "...", "text": [...], "images": [...] },
    ...
  }
}
```

Every entry in a page's `text`/`images` array is one **placement**:

```jsonc
{
  "id": "home.hero.title",
  "kind": "text",
  "page": "index.html",
  "selector": ".hero__title",       // resolves to exactly one element — asserted at generation time
  "tag": "h1",
  "role": "heroTitle",
  "fillSource": "llm",
  "original": "Find the home that fits your next chapter",   // the template's own copy — a length/style reference, never presented as "the answer"
  "constraints": { "minChars": 16, "maxChars": 54, "minWords": 4, "maxWords": 9, "maxLines": 2 },
  "notes": "Drops the source's <em>-accented word — a model's answer is plain text."
}
```

An image placement looks the same shape, with `domKind` (`"img"` rewrites `src`; `"background"`
rewrites a CSS `background-image: url(...)`), `subject` (what the photo should show — also the seed
for a stock-photo search query), and `constraints.{aspectRatio,minWidthPx,minHeightPx}` instead of a
character budget.

### `constraints` — how the numbers are derived

`minChars`/`maxChars` come from the box's own real typography (font-size, line-height) and width,
read off the shared stylesheet (`src/templates/placements/measure.ts`), anchored so the ceiling is
never below the length of the copy already shipping there today — that copy is proof the box can
hold at least that much. `maxLines` is informational (how many lines the box was designed for);
`maxChars` is what `fill.ts` actually enforces, since line count depends on the exact characters
typed, not just how many there are. A short label (a nav link, a badge) uses a plain word-count cap
instead of the geometric estimate — "does it read as a label" matters more than pixel-fit for text
that short.

### `fillSource` — who's allowed to write this placement, and why

| `fillSource` | Comes from | Why |
|---|---|---|
| `fixed` | nobody — always the template's own text | Pure UI mechanics ("Search", "Join", form field labels). No brand-voice value, no reason to ever change it. |
| `brief` | the business's own profile (name, phone, email, address, license number, hours) | Never invented. |
| `data` | the business's own records (a listing's price/address, an agent's name/photo, a real customer testimonial, a business stat) — falls back to the template's own (clearly fictional) demo value when no record exists yet | Fabricating a specific price, street address, or customer quote is a **trust problem**, not a copy-quality one. This is the same line `src/templates/copy-slots.ts` already draws around testimonials and team photos for this project's scraped-template corpus — generalized here to every specific factual claim a real-estate site makes. |
| `llm` | a model, bounded by `constraints` | Genuine marketing prose — headlines, section copy, a plausible property description when no real listing feed exists yet. |
| `llmQuery` (images only) | a model supplies a short stock-photo search query, never a URL | Mirrors `src/agents/verbatim-media-agent.ts`'s existing pattern for the scraped-template corpus. |

Some `llm` placements are short labels that decorate a functionally-fixed target — a nav link's
exact wording, a footer category heading. These stay `llm` (tightly word-capped) rather than `fixed`
because the four templates in this folder demonstrably use different wording for the same link today
(`"Our Agents"` / `"Our Brokers"` / `"Our Advisors"` / `"Our Team"` all point at `agents.html`) — but
each carries a `notes` field stating what the label must still mean, since the underlying page it
links to cannot change.

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

## The LLM contract

Send a model **only** the placements whose `fillSource` is `"llm"` or `"llmQuery"` — never the whole
file, and never any HTML. A minimal per-placement payload:

```json
{ "id": "home.hero.title", "role": "heroTitle", "original": "Find the home that fits your next chapter",
  "constraints": { "maxChars": 54, "maxWords": 9 }, "notes": null }
```

Expected response — one object, `values` keyed by placement id, covering only the ids it was asked
about:

```json
{ "values": {
  "home.hero.title": "Homes that fit your next chapter, found faster",
  "home.hero.subtitle": "Local expertise, honest advice, and access to homes before they hit the open market.",
  "chrome.nav.cta": "Get a Free Valuation"
} }
```

For an `llmQuery` image placement, the value is a short plain-English stock-photo search query (e.g.
`"modern suburban home exterior dusk"`), not a URL — resolve it through your own stock-photo provider
before calling `applyPlacements` (see below).

## Applying the result

```ts
import { extractRealEstateTemplate } from "../src/templates/placements/extract.js";
import { applyPlacements } from "../src/templates/placements/fill.js";

const file = await extractRealEstateTemplate("real-estate/real-estate-agency", "real-estate-agency");
const html = await fs.readFile("real-estate/real-estate-agency/index.html", "utf8");

const result = await applyPlacements(html, file.pages["index.html"], {
  brief: { businessName: "Bay Breeze Realty", phone: "(415) 555-0100", /* ... */ },
  resolveData: async (placement) => lookupFromYourOwnListingsOrRoster(placement), // `data` placements
  llmValues: modelResponse.values,                                               // `llm`/`llmQuery` placements
});

await fs.writeFile("dist/index.html", result.html, "utf8");
console.log(result.clamped);       // every value that got truncated or rejected, and why
console.log(result.rejectedFixed); // any `fixed` placement a caller mistakenly supplied a value for
```

`applyPlacements` never throws on a bad or missing value — a placement `fill.ts` cannot resolve
simply keeps the template's own original copy, which is always a safe, complete page.

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
