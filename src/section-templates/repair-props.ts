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
      if (out.image === undefined || out.image === null) out.image = {};
      break;
    }

    case "intro_statement": {
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
            value: coerceToString(row.value) ?? "—",
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
      out.items = padArrayToMin(items, 2, (i) => ({
        title: `Feature ${i + 1}`,
        description: "Tailored to your needs.",
        span: "normal",
      }));
      break;
    }

    default:
      break;
  }

  return out;
}
