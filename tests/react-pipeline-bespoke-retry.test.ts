import { describe, it, expect } from "vitest";
import {
  parseFailedCustomComponent,
  dropCustomCodegenByFileName,
  dropAllCustomCodegen,
} from "../src/orchestrator/react-pipeline.js";
import type { ReactPage } from "../src/types.js";

describe("react-pipeline bespoke-section build retry", () => {
  it("extracts the broken custom component file from a Next.js build error", () => {
    const err = `
Failed to compile.

./components/custom/CustomHomeHero.tsx:12:5
Type error: Property 'headline' does not exist on type 'CustomHomeHeroProps'.
`;
    expect(parseFailedCustomComponent(err)).toBe("CustomHomeHero.tsx");
  });

  it("returns null when the build error isn't about a custom component", () => {
    const err = "Failed to compile.\n./app/about/page.tsx:3:1\nType error: Cannot find module 'x'.";
    expect(parseFailedCustomComponent(err)).toBeNull();
  });

  it("drops customCodegen from the matching section across pages, leaving others intact", () => {
    const reactPages: Record<string, ReactPage> = {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          {
            id: "home_hero",
            templateId: "hero_editorial",
            intent: "hero",
            props: { headline: "Hi" },
            customCodegen: {
              componentName: "CustomHomeHero",
              fileName: "CustomHomeHero.tsx",
              source: "export default function CustomHomeHero() { return null; }",
            },
          },
          {
            id: "home_bento",
            templateId: "feature_bento",
            intent: "features",
            props: { items: [] },
            customCodegen: {
              componentName: "CustomHomeBento",
              fileName: "CustomHomeBento.tsx",
              source: "export default function CustomHomeBento() { return null; }",
            },
          },
        ],
      },
    };

    const dropped = dropCustomCodegenByFileName(reactPages, "CustomHomeHero.tsx");
    expect(dropped).toBe(true);
    expect(reactPages.home!.sections[0]!.customCodegen).toBeUndefined();
    expect(reactPages.home!.sections[1]!.customCodegen?.fileName).toBe("CustomHomeBento.tsx");
  });

  it("returns false when no section matches the given file name", () => {
    const reactPages: Record<string, ReactPage> = {
      home: { slug: "home", title: "Home", sections: [] },
    };
    expect(dropCustomCodegenByFileName(reactPages, "CustomMissing.tsx")).toBe(false);
  });

  it("dropAllCustomCodegen clears bespoke sections on every page", () => {
    const reactPages: Record<string, ReactPage> = {
      home: {
        slug: "home",
        title: "Home",
        sections: [
          {
            id: "home_hero",
            templateId: "hero_editorial",
            intent: "hero",
            props: {},
            customCodegen: {
              componentName: "CustomHomeHero",
              fileName: "CustomHomeHero.tsx",
              source: "export default function CustomHomeHero() { return null; }",
            },
          },
        ],
      },
      about: {
        slug: "about",
        title: "About",
        sections: [
          {
            id: "about_intro",
            templateId: "intro_statement",
            intent: "intro",
            props: {},
            customCodegen: {
              componentName: "CustomAboutIntro",
              fileName: "CustomAboutIntro.tsx",
              source: "export default function CustomAboutIntro() { return null; }",
            },
          },
        ],
      },
    };

    expect(dropAllCustomCodegen(reactPages)).toBe(2);
    expect(reactPages.home!.sections[0]!.customCodegen).toBeUndefined();
    expect(reactPages.about!.sections[0]!.customCodegen).toBeUndefined();
  });
});
