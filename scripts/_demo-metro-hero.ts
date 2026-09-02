import path from "path";
import express from "express";
import { generateReactProject, buildReactProject } from "../src/react-codegen/assemble-project.js";
import { initSiteContext } from "../src/site-context/assemble.js";
import { mockPlan } from "../tests/helpers/mock-site.js";

const OUT = path.resolve("output", "_demo-metro-hero");
const PORT = 3848;

const brief = {
  businessName: "Metro Studio",
  tagline: "Every still leads to the next",
  elevatorPitch: "Design studio",
  expandedBrief: "A design studio.",
  targetAudience: "Founders",
  services: ["Brand", "Product", "Motion"],
  differentiators: ["Craft"],
  tone: "Confident",
  primaryCta: "Book a call",
};
const sitePlan = mockPlan(brief);
const ctx = initSiteContext("Studio", brief, sitePlan, {
  vertical: "studio",
  mood: "editorial",
  fontHeading: "Inter",
  fontBody: "Inter",
  colors: {
    bg: "#07080c",
    surface: "#111319",
    text: "#f4f4f5",
    muted: "#9a9aa2",
    accent: "#e85d04",
    accentSoft: "#2a1f14",
    gradientFrom: "#e85d04",
    gradientTo: "#f48c06",
    navBg: "#0a0b10",
    navText: "#f4f4f5",
    navMuted: "#9a9aa2",
    navActiveBg: "#e85d04",
    navActiveText: "#fff",
  },
});

const IMAGES = [
  "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80",
  "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1600&q=80",
  "https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=1600&q=80",
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80",
];

ctx.reactPages = {
  home: {
    slug: "home",
    title: "Home",
    sections: [
      {
        id: "home_hero",
        templateId: "hero_metro",
        intent: "Hero",
        props: {
          label: "Look ahead",
          headline: "Metro Studio",
          subcopy: "Every still leads to the next.",
          comingUpLabel: "Coming up",
          images: [
            { caption: "Brand", image: { src: IMAGES[0], alt: "Brand identity work" } },
            { caption: "Product", image: { src: IMAGES[1], alt: "Product design work" } },
            { caption: "Motion", image: { src: IMAGES[2], alt: "Motion design work" } },
            { caption: "Studio", image: { src: IMAGES[3], alt: "Studio space" } },
          ],
          cta: { label: "Book a call", href: "/contact" },
        },
      },
    ],
  },
} as any;

async function main() {
  const { projectPath } = await generateReactProject(ctx, ctx.reactPages as any, OUT);
  console.log("[demo] project written →", projectPath);
  const outPath = await buildReactProject(projectPath);
  console.log("[demo] static export built →", outPath);

  const app = express();
  app.use(express.static(outPath, { index: "index.html", extensions: ["html"] }));
  app.listen(PORT, () => {
    console.log(`[demo] Metro Hero live → http://localhost:${PORT}`);
    console.log("[demo] Scroll down slowly inside the hero to watch the image reveal.");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
