import {
  coerceToString,
  coerceToStringArray,
  normalizeCopyProps,
  padArrayToMin,
} from "../llm/normalize-llm-output.js";

function statFallback(index: number): { value: string; label: string } {
  const defaults = [
    { value: "500+", label: "Clients served" },
    { value: "98%", label: "Satisfaction" },
    { value: "10+", label: "Years experience" },
  ];
  return defaults[index % defaults.length]!;
}

function faqFallback(index: number): { question: string; answer: string } {
  const defaults = [
    {
      question: "How do I get started?",
      answer: "Reach out through our contact page and we will guide you through the next steps.",
    },
    {
      question: "What areas do you serve?",
      answer: "We work with clients locally and remotely, depending on your needs.",
    },
  ];
  return defaults[index % defaults.length]!;
}

/** Fill common LLM omissions before Zod validation (raw React + template pipeline). */
export function repairTemplateProps(
  templateId: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out = normalizeCopyProps(templateId, { ...raw });

  switch (templateId) {
    case "services_showcase": {
      let paragraphs = coerceToStringArray(out.paragraphs);
      if (!paragraphs?.length && Array.isArray(out.services)) {
        paragraphs = out.services
          .map((s) => {
            if (typeof s === "string") return s.trim();
            if (!s || typeof s !== "object" || Array.isArray(s)) return null;
            const row = s as Record<string, unknown>;
            const title = coerceToString(row.title) ?? coerceToString(row.name);
            const desc =
              coerceToString(row.description) ??
              coerceToString(row.body) ??
              coerceToString(row.text);
            if (title && desc) return `${title} — ${desc}`;
            return desc ?? title;
          })
          .filter((p): p is string => Boolean(p));
      }
      if (!paragraphs?.length) {
        const fallback =
          coerceToString(out.body) ??
          coerceToString(out.subcopy) ??
          coerceToString(out.description) ??
          coerceToString(out.text) ??
          coerceToString(out.headline);
        paragraphs = fallback ? [fallback] : ["Discover what we offer and how we can help."];
      }
      out.paragraphs = paragraphs.slice(0, 3);
      delete out.body;
      delete out.subcopy;
      delete out.description;
      delete out.text;
      delete out.services;
      if (out.image === undefined || out.image === null) out.image = {};
      break;
    }

    case "intro_statement": {
      if (!coerceToString(out.headline)) {
        out.headline =
          coerceToString(out.title) ??
          coerceToString(out.label) ??
          coerceToString(out.heading) ??
          "Our story";
      }
      if (!coerceToString(out.body)) {
        out.body =
          coerceToString(out.subcopy) ??
          coerceToString(out.description) ??
          coerceToString(out.text) ??
          coerceToString(out.headline) ??
          "We are dedicated to excellence in everything we do.";
      }
      break;
    }

    case "stats_marquee":
    case "stats_animated": {
      const rawStats = Array.isArray(out.stats) ? out.stats : [];
      const stats = rawStats
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s) => {
          const row = s as Record<string, unknown>;
          return {
            value: coerceToString(row.value) ?? coerceToString(row.number) ?? "—",
            label: coerceToString(row.label) ?? "Metric",
          };
        });
      out.stats = padArrayToMin(stats, 2, statFallback);
      break;
    }

    case "faq_accordion": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s) => {
          const row = s as Record<string, unknown>;
          return {
            question: coerceToString(row.question) ?? "Question",
            answer: coerceToString(row.answer) ?? "Answer",
          };
        });
      out.items = padArrayToMin(items, 2, faqFallback);
      break;
    }

    case "text_marquee": {
      let phrases = coerceToStringArray(out.phrases);
      if (!phrases?.length) {
        const fallback = coerceToString(out.headline) ?? coerceToString(out.label);
        phrases = fallback ? [fallback, "Quality", "Craft"] : ["Quality", "Craft", "Care"];
      }
      out.phrases = padArrayToMin(phrases.slice(0, 8), 2, (i) => `Phrase ${i + 1}`);
      break;
    }

    case "scroll_showcase": {
      if (Array.isArray(out.steps)) {
        const steps = out.steps
          .filter((s) => s && typeof s === "object" && !Array.isArray(s))
          .map((s, i) => {
            const row = s as Record<string, unknown>;
            return {
              title: coerceToString(row.title) ?? `Step ${i + 1}`,
              description: coerceToString(row.description) ?? "Details coming soon.",
            };
          })
          .slice(0, 5);
        out.steps = steps.length >= 2 ? steps : undefined;
      }
      break;
    }

    case "gallery_masonry": {
      const rawImages = Array.isArray(out.images) ? out.images : [];
      const images = rawImages
        .filter((im) => im && typeof im === "object" && !Array.isArray(im))
        .map((im, i): Record<string, unknown> => {
          const row = im as Record<string, unknown>;
          return {
            ...row,
            imageQuery:
              coerceToString(row.imageQuery) ??
              coerceToString(row.caption) ??
              `gallery image ${i + 1}`,
          };
        })
        .slice(0, 12);
      // Media curation already resolved a real `src` for any images the LLM did return —
      // reuse one of those (rather than a bare imageQuery placeholder with no `src`) when
      // padding up to the schema minimum, so an under-filled gallery doesn't ship blank tiles.
      const resolved = images.find((im) => typeof im.src === "string" && im.src);
      out.images = padArrayToMin(images, 3, (i) =>
        resolved ? { ...resolved } : { imageQuery: `gallery image ${i + 1}` }
      );
      break;
    }

    case "before_after": {
      if (out.before === undefined || out.before === null) {
        out.before = { imageQuery: "before transformation" };
      }
      if (out.after === undefined || out.after === null) {
        out.after = { imageQuery: "after transformation" };
      }
      break;
    }

    case "cta_band":
    case "footer_cta": {
      const rawCta =
        out.cta && typeof out.cta === "object" && !Array.isArray(out.cta)
          ? (out.cta as Record<string, unknown>)
          : {};
      out.cta = {
        ...rawCta,
        label:
          coerceToString(rawCta.label) ??
          coerceToString(out.headline) ??
          "Get started",
      };
      break;
    }

    case "hero_editorial":
    case "hero_split_cinematic":
    case "hero_spotlight":
    case "hero_video": {
      if (!coerceToString(out.headline)) {
        out.headline =
          coerceToString(out.title) ??
          coerceToString(out.label) ??
          coerceToString(out.heading) ??
          "Welcome";
      }
      break;
    }

    case "testimonial_featured": {
      if (!coerceToString(out.quote)) {
        out.quote =
          coerceToString(out.text) ??
          coerceToString(out.body) ??
          "Outstanding experience from start to finish.";
      }
      if (!coerceToString(out.author)) {
        out.author = coerceToString(out.name) ?? coerceToString(out.client) ?? "Happy client";
      }
      break;
    }

    case "testimonial_carousel": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            quote:
              coerceToString(row.quote) ??
              coerceToString(row.text) ??
              coerceToString(row.body) ??
              "Outstanding experience from start to finish.",
            author: coerceToString(row.author) ?? coerceToString(row.name) ?? "Happy client",
          };
        });
      out.items = padArrayToMin(items, 2, (i) => ({
        quote: "Outstanding experience from start to finish.",
        author: `Client ${i + 1}`,
      }));
      break;
    }

    case "pricing_tiers": {
      const rawTiers = Array.isArray(out.tiers) ? out.tiers : [];
      const tiers = rawTiers
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            name: coerceToString(row.name) ?? coerceToString(row.title) ?? `Plan ${i + 1}`,
            price: coerceToString(row.price) ?? "Contact us",
          };
        });
      out.tiers = padArrayToMin(tiers, 1, (i) => ({ name: `Plan ${i + 1}`, price: "Contact us" }));
      break;
    }

    case "pricing_toggle": {
      const rawTiers = Array.isArray(out.tiers) ? out.tiers : [];
      const tiers = rawTiers
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            name: coerceToString(row.name) ?? coerceToString(row.title) ?? `Plan ${i + 1}`,
            monthlyPrice: coerceToString(row.monthlyPrice) ?? coerceToString(row.price) ?? "Contact us",
            yearlyPrice: coerceToString(row.yearlyPrice) ?? coerceToString(row.price) ?? "Contact us",
          };
        });
      out.tiers = padArrayToMin(tiers, 1, (i) => ({
        name: `Plan ${i + 1}`,
        monthlyPrice: "Contact us",
        yearlyPrice: "Contact us",
      }));
      break;
    }

    case "contact_split": {
      if (!coerceToString(out.headline)) {
        out.headline = coerceToString(out.title) ?? coerceToString(out.label) ?? "Get in touch";
      }
      break;
    }

    case "portfolio_strip": {
      const rawProjects = Array.isArray(out.projects) ? out.projects : [];
      const projects = rawProjects
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            title: coerceToString(row.title) ?? coerceToString(row.name) ?? `Project ${i + 1}`,
          };
        });
      out.projects = padArrayToMin(projects, 2, (i) => ({ title: `Project ${i + 1}` }));
      break;
    }

    case "portfolio_carousel": {
      const rawSlides = Array.isArray(out.slides) ? out.slides : [];
      const slides = rawSlides
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            title: coerceToString(row.title) ?? coerceToString(row.name) ?? `Project ${i + 1}`,
          };
        });
      out.slides = padArrayToMin(slides, 3, (i) => ({ title: `Project ${i + 1}` }));
      break;
    }

    case "team_grid": {
      const rawMembers = Array.isArray(out.members) ? out.members : [];
      const members = rawMembers
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            name: coerceToString(row.name) ?? `Team member ${i + 1}`,
            role:
              coerceToString(row.role) ??
              coerceToString(row.title) ??
              coerceToString(row.position) ??
              "Team member",
          };
        });
      out.members = padArrayToMin(members, 2, (i) => ({
        name: `Team member ${i + 1}`,
        role: "Team member",
      }));
      break;
    }

    case "logo_marquee": {
      const rawLogos = Array.isArray(out.logos) ? out.logos : [];
      const logos = rawLogos
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return { ...row, name: coerceToString(row.name) ?? `Partner ${i + 1}` };
        });
      out.logos = padArrayToMin(logos, 3, (i) => ({ name: `Partner ${i + 1}` }));
      break;
    }

    case "horizontal_gallery": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            ...row,
            title: coerceToString(row.title) ?? coerceToString(row.name) ?? `Highlight ${i + 1}`,
          };
        });
      out.items = padArrayToMin(items, 3, (i) => ({ title: `Highlight ${i + 1}` }));
      break;
    }

    case "newsletter_band": {
      if (!coerceToString(out.headline)) {
        out.headline = coerceToString(out.title) ?? coerceToString(out.label) ?? "Stay in the loop";
      }
      break;
    }

    case "feature_bento": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            title: coerceToString(row.title) ?? `Feature ${i + 1}`,
            description: coerceToString(row.description) ?? "Details coming soon.",
            ...(row.span ? { span: row.span } : {}),
            ...(row.image ? { image: row.image } : {}),
          };
        });
      out.items = padArrayToMin(items, 3, (i) => ({
        title: `Offering ${i + 1}`,
        description: "Describe a concrete benefit for this business.",
        span: i === 0 ? "wide" : "normal",
      }));
      break;
    }

    default:
      break;
  }

  return out;
}
