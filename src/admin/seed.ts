import { IngestSourceSchema, type IngestSource } from "./types.js";

const now = 1_700_000_000_000;

function source(
  partial: Pick<IngestSource, "id" | "name" | "kind" | "originUrl"> & Partial<IngestSource>
): IngestSource {
  return IngestSourceSchema.parse({
    expectedLicense: "MIT",
    defaultCategory: "creative",
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

export const SEED_SOURCES: IngestSource[] = [
  source({
    id: "src-hyperui",
    name: "HyperUI",
    kind: "github",
    originUrl: "https://github.com/markmead/hyperui",
    demoUrl: "https://www.hyperui.dev/",
    notes: "MIT marketing components — ingest as composition recipes only",
  }),
  source({
    id: "src-startbootstrap-landing",
    name: "Start Bootstrap landing page",
    kind: "github",
    originUrl: "https://github.com/StartBootstrap/startbootstrap-landing-page",
    demoUrl: "https://startbootstrap.github.io/startbootstrap-landing-page/",
    defaultCategory: "local-service",
    notes: "MIT landing — masthead, features, flipping showcases, testimonials, CTA",
  }),
  source({
    id: "src-tailgrids-play",
    name: "TailGrids Play",
    kind: "github",
    originUrl: "https://github.com/TailGrids/play-tailwind",
    demoUrl: "https://play-tailwind.tailgrids.com/",
    notes: "MIT Tailwind landing starter",
  }),
  source({
    id: "src-astrowind",
    name: "AstroWind",
    kind: "github",
    originUrl: "https://github.com/onwidget/astrowind",
    demoUrl: "https://astrowind.vercel.app/",
    notes: "MIT Astro marketing template",
  }),
];
