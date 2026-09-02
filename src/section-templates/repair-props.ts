import {
  coerceEnumValue,
  coerceToNumber,
  coerceToString,
  coerceToStringArray,
  normalizeCopyProps,
  padArrayToMin,
} from "../llm/normalize-llm-output.js";

const CONTACT_FIELD_TYPES = ["text", "email", "tel", "textarea", "select"] as const;
const CONTACT_FIELD_TYPE_SYNONYMS: Record<string, string> = {
  date: "text",
  number: "text",
  phone: "tel",
  telephone: "tel",
  "phone number": "tel",
  message: "textarea",
  "text area": "textarea",
  dropdown: "select",
  choice: "select",
  checkbox: "select",
};

function contactFieldLabel(row: Record<string, unknown>, index: number): string {
  const type = coerceToString(row.type)?.toLowerCase();
  const fallbackByType: Record<string, string> = {
    email: "Email",
    tel: "Phone",
    textarea: "Message",
    select: "Topic",
  };
  return (
    coerceToString(row.name) ??
    coerceToString(row.placeholder) ??
    (type ? fallbackByType[type] : undefined) ??
    `Field ${index + 1}`
  );
}

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
      if (out.speed !== undefined) {
        const speed = coerceEnumValue(out.speed, ["slow", "normal", "fast"], {
          medium: "normal",
          moderate: "normal",
          med: "normal",
          default: "normal",
          quick: "fast",
          rapid: "fast",
        });
        if (speed) out.speed = speed;
        else delete out.speed;
      }
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
    case "hero_video":
    case "hero_statement": {
      if (!coerceToString(out.headline)) {
        out.headline =
          coerceToString(out.title) ??
          coerceToString(out.label) ??
          coerceToString(out.heading) ??
          "Welcome";
      }
      break;
    }

    case "hero_metro": {
      if (!coerceToString(out.headline)) {
        out.headline =
          coerceToString(out.title) ??
          coerceToString(out.label) ??
          coerceToString(out.heading) ??
          "Welcome";
      }
      const headline = coerceToString(out.headline) ?? "Welcome";
      const poster =
        out.video && typeof out.video === "object" && !Array.isArray(out.video)
          ? ((out.video as Record<string, unknown>).poster as Record<string, unknown> | undefined)
          : undefined;
      const rawImages = Array.isArray(out.images) ? out.images : [];
      const images = rawImages
        .filter((row) => row && typeof row === "object" && !Array.isArray(row))
        .map((row, i) => {
          const item = row as Record<string, unknown>;
          const nested =
            item.image && typeof item.image === "object" && !Array.isArray(item.image)
              ? (item.image as Record<string, unknown>)
              : item.src || item.imageQuery
                ? item
                : poster ?? { imageQuery: headline };
          return {
            caption: coerceToString(item.caption) ?? coerceToString(nested.alt) ?? `Still ${i + 1}`,
            image: nested,
          };
        });
      if (images.length === 0 && poster) {
        images.push({ caption: headline, image: poster });
      }
      out.images = padArrayToMin(images, 3, (i) => ({
        caption: `Still ${i + 1}`,
        image: { imageQuery: `${headline} cinematic ${i + 1}` },
      })).slice(0, 5);
      delete out.lockPage;
      delete out.video;
      break;
    }

    case "story_split": {
      if (!coerceToString(out.headline)) {
        out.headline =
          coerceToString(out.title) ??
          coerceToString(out.label) ??
          "Our story";
      }
      let paragraphs = coerceToStringArray(out.paragraphs);
      if (!paragraphs?.length) {
        const fallback =
          coerceToString(out.body) ??
          coerceToString(out.subcopy) ??
          coerceToString(out.headline);
        paragraphs = fallback ? [fallback] : ["We built this practice around the people we serve."];
      }
      out.paragraphs = paragraphs.slice(0, 4);
      if (out.image === undefined || out.image === null) out.image = {};
      delete out.body;
      break;
    }

    case "offer_index": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            title: coerceToString(row.title) ?? coerceToString(row.name) ?? `Offering ${i + 1}`,
            description:
              coerceToString(row.description) ??
              coerceToString(row.body) ??
              "Describe a concrete benefit for this business.",
          };
        });
      out.items = padArrayToMin(items, 3, (i) => ({
        title: `Offering ${i + 1}`,
        description: "Describe a concrete benefit for this business.",
      }));
      break;
    }

    case "hours_location": {
      const raw = Array.isArray(out.schedule) ? out.schedule : [];
      const schedule = raw
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            day: coerceToString(row.day) ?? `Day ${i + 1}`,
            time: coerceToString(row.time) ?? "By appointment",
          };
        });
      out.schedule = padArrayToMin(schedule, 3, (i) => {
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return { day: days[i] ?? `Day ${i + 1}`, time: "9:00 – 18:00" };
      });
      break;
    }

    case "menu_board": {
      const rawItems = Array.isArray(out.items) ? out.items : [];
      const items = rawItems
        .filter((s) => s && typeof s === "object" && !Array.isArray(s))
        .map((s, i) => {
          const row = s as Record<string, unknown>;
          return {
            name: coerceToString(row.name) ?? coerceToString(row.title) ?? `Item ${i + 1}`,
            price: coerceToString(row.price) ?? "Market",
            ...(coerceToString(row.description)
              ? { description: coerceToString(row.description) }
              : {}),
          };
        });
      out.items = padArrayToMin(items, 3, (i) => ({
        name: `Item ${i + 1}`,
        price: "Market",
      }));
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
      if (Array.isArray(out.formFields)) {
        out.formFields = out.formFields
          .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
          .map((row, i) => {
            const type =
              coerceEnumValue(row.type, CONTACT_FIELD_TYPES, CONTACT_FIELD_TYPE_SYNONYMS) ?? "text";
            const repaired: Record<string, unknown> = {
              ...row,
              label: coerceToString(row.label) ?? contactFieldLabel(row, i),
              type,
            };
            if (typeof row.required === "string") {
              repaired.required = row.required.trim().toLowerCase() === "true";
            }
            if (type !== "select") delete repaired.options;
            else if (!Array.isArray(row.options) || row.options.length === 0) {
              delete repaired.options;
            }
            return repaired;
          });
      }
      break;
    }

    case "quote_calculator": {
      if (!coerceToString(out.headline)) {
        out.headline = coerceToString(out.title) ?? "Estimate your project";
      }
      if (out.unitLabel !== undefined) {
        const unit = coerceEnumValue(out.unitLabel, ["hours", "guests", "rooms", "sessions"], {
          people: "guests",
          persons: "guests",
          attendees: "guests",
          appointments: "sessions",
          bookings: "sessions",
          nights: "rooms",
        });
        if (unit) out.unitLabel = unit;
        else delete out.unitLabel;
      }
      for (const key of ["minQuantity", "maxQuantity", "defaultQuantity"] as const) {
        if (out[key] === undefined) continue;
        const n = coerceToNumber(out[key]);
        if (n !== undefined) out[key] = n;
        else delete out[key];
      }
      const rawPackages = Array.isArray(out.packages) ? out.packages : [];
      const packages = rawPackages
        .filter((row) => row && typeof row === "object" && !Array.isArray(row))
        .map((row, i) => {
          const item = row as Record<string, unknown>;
          return {
            ...item,
            name: coerceToString(item.name) ?? `Package ${i + 1}`,
            pricePerUnit: item.pricePerUnit ?? 100,
          };
        });
      out.packages = padArrayToMin(packages, 1, (i) => ({
        name: `Package ${i + 1}`,
        pricePerUnit: 100,
      }));
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
