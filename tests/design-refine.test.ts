import { describe, it, expect } from "vitest";
import { refineDesignSystem } from "../src/agents/design-refine-agent.js";
import { GENERIC_THEME } from "../src/agents/theme-agent.js";
import { runDesignQA } from "../src/qa/react-qa.js";
import { ensureReadableTheme } from "../src/theme/contrast.js";

describe("design refine agent", () => {
  it("refines glass-light on light page in mock mode", async () => {
    const draft = ensureReadableTheme({
      ...GENERIC_THEME,
      pageTone: "light",
      navTreatment: "glass-light",
      colors: {
        ...GENERIC_THEME.colors,
        bg: "#fafafa",
        surface: "#ffffff",
        text: "#111111",
        muted: "#666666",
        navBg: "rgba(255,255,255,0.92)",
        navText: "#f1f5f9",
      },
    });

    const refined = await refineDesignSystem("Dstyle", "Fashion boutique", draft);
    expect(refined.navTreatment).not.toBe("glass-light");
    const qa = runDesignQA(refined);
    expect(qa.issues.filter((i) => i.severity === "hard")).toHaveLength(0);
  });
});
