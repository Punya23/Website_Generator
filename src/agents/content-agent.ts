import type { ContentBlock, ExpandedBrief, PagePlan } from "../types.js";
import { llm } from "../llm/client.js";
import { briefToContext } from "./expand-brief-agent.js";

const CONTENT_SYSTEM = `You are an expert website copywriter. Write rich, specific, conversion-focused content.
You have ZERO layout awareness — never mention grids, columns, or placement.

Output valid JSON: { "blocks": [ ... ] }

Block types (each needs unique "id" in snake_case):
- headline: { text, subtext? } — page title; on HOME only this becomes a cinematic hero
- stat: { value, label } — metrics, numbers, proof points
- testimonial: { quote, author, role? }
- cta: { headline, subtext?, buttonText, buttonUrl? }
- text: { title?, text } — paragraphs of real substance (80-200 words each for major sections)
- feature: { title, description } — service/product detail (description 40-80 words)
- gallery: { caption, imageQuery } — imageQuery = 2-5 word Unsplash search
- image: { alt, imageQuery }
- contact: { title?, email?, phone?, address?, hours? }
- faq: { question, answer } — for FAQ-style content

REQUIREMENTS:
- Meet or exceed minBlocks count
- Cover EVERY item in contentFocus with depth
- Use the brand tone consistently
- Include varied block types — not just features
- Multiple text blocks with real paragraphs, not one-liners
- 3-5 testimonials on home, 2+ on other pages where relevant
- 4-8 stats across the site pages collectively; include relevant stats on this page
- imageQuery on ALL image/gallery blocks
- NO src URLs, NO layout fields`;

export async function generateContent(
  brief: ExpandedBrief,
  pagePlan: PagePlan
): Promise<ContentBlock[]> {
  if (llm.isAvailable) {
    const raw = await llm.chat(
      CONTENT_SYSTEM,
      `${briefToContext(brief)}

PAGE: ${pagePlan.slug} (${pagePlan.title})
Goal: ${pagePlan.goal}
minBlocks: ${pagePlan.minBlocks}
Content focus: ${pagePlan.contentFocus.join(", ")}
Layout hint (for tone only, do NOT implement): ${pagePlan.layoutHint}

Generate ${pagePlan.minBlocks}+ content blocks. Be thorough and specific to ${brief.businessName}.`,
      { jsonMode: true, temperature: 0.85, maxTokens: 6144 }
    );
    const parsed = JSON.parse(raw) as { blocks: ContentBlock[] };
    return parsed.blocks;
  }

  return mockContent(brief, pagePlan);
}

function mockContent(brief: ExpandedBrief, plan: PagePlan): ContentBlock[] {
  const p = plan.slug;
  const blocks: ContentBlock[] = [];

  blocks.push({
    id: `${p}_headline`,
    type: "headline",
    text: plan.slug === "home" ? brief.businessName : plan.title,
    subtext: plan.slug === "home" ? brief.tagline : brief.elevatorPitch,
  });

  if (plan.slug === "home") {
    blocks.push({
      id: `${p}_intro`,
      type: "text",
      title: "Why clients choose us",
      text: brief.expandedBrief,
    });
    for (let i = 0; i < 4; i++) {
      blocks.push({
        id: `${p}_stat_${i}`,
        type: "stat",
        value: ["500+", "4.9★", "15+", "98%"][i]!,
        label: ["Happy clients", "Average rating", "Expert stylists", "Would recommend"][i]!,
      });
    }
    brief.services.slice(0, 6).forEach((svc, i) => {
      blocks.push({
        id: `${p}_feature_${i}`,
        type: "feature",
        title: svc,
        description: `Our ${svc.toLowerCase()} service is tailored to your unique needs. ${brief.differentiators[i % brief.differentiators.length]}. Book a consultation to learn more.`,
      });
    });
    for (let i = 0; i < 3; i++) {
      blocks.push({
        id: `${p}_gallery_${i}`,
        type: "gallery",
        caption: ["Our studio", "Recent transformations", "The experience"][i],
        imageQuery: ["hair salon interior", "balayage hair", "salon styling"][i],
      });
    }
    for (let i = 0; i < 3; i++) {
      blocks.push({
        id: `${p}_testimonial_${i}`,
        type: "testimonial",
        quote: [
          "I've never felt more confident leaving a salon. The attention to detail is unmatched.",
          "They listened to exactly what I wanted and delivered beyond my expectations.",
          "The best investment I make for myself every month. Worth every penny.",
        ][i]!,
        author: ["Sarah M.", "James K.", "Elena R."][i]!,
        role: ["Regular client", "Bridal client", "Color client"][i],
      });
    }
    blocks.push({
      id: `${p}_cta`,
      type: "cta",
      headline: brief.primaryCta,
      subtext: "Limited appointments available this week.",
      buttonText: brief.primaryCta,
      buttonUrl: "#book",
    });
    blocks.push({
      id: `${p}_img`,
      type: "image",
      alt: "Our space",
      imageQuery: "business interior professional",
    });
    return blocks;
  }

  if (plan.slug === "about") {
    blocks.push({ id: `${p}_story`, type: "text", title: "Our story", text: brief.expandedBrief });
    blocks.push({ id: `${p}_mission`, type: "text", title: "Mission & values", text: `We believe in ${brief.differentiators.join(", ").toLowerCase()}. Our team serves ${brief.targetAudience} with integrity and care.` });
    brief.differentiators.forEach((d, i) => {
      blocks.push({ id: `${p}_feature_${i}`, type: "feature", title: d, description: `${d} — this principle guides every interaction at ${brief.businessName}.` });
    });
    blocks.push({ id: `${p}_img`, type: "image", alt: "Our team", imageQuery: "professional team workspace" });
    blocks.push({ id: `${p}_testimonial`, type: "testimonial", quote: "A team that genuinely cares about outcomes.", author: "Long-time client" });
    return blocks;
  }

  if (plan.slug === "services" || plan.slug === "gallery") {
    brief.services.forEach((svc, i) => {
      blocks.push({
        id: `${p}_feature_${i}`,
        type: "feature",
        title: svc,
        description: `Comprehensive ${svc.toLowerCase()} for ${brief.targetAudience}. We combine expertise with personalized attention to deliver results that exceed expectations.`,
      });
      if (i % 2 === 0) {
        blocks.push({ id: `${p}_detail_${i}`, type: "text", title: `About ${svc}`, text: `Learn how our approach to ${svc.toLowerCase()} sets us apart. ${brief.elevatorPitch}` });
      }
    });
    for (let i = 0; i < 4; i++) {
      blocks.push({ id: `${p}_gallery_${i}`, type: "gallery", caption: brief.services[i] ?? "Our work", imageQuery: brief.services[i] ?? "business service" });
    }
    blocks.push({ id: `${p}_cta`, type: "cta", headline: brief.primaryCta, buttonText: brief.primaryCta });
    return blocks;
  }

  if (plan.slug === "team") {
    const names = ["Alex Rivera", "Jordan Lee", "Sam Taylor", "Casey Morgan"];
    names.forEach((name, i) => {
      blocks.push({
        id: `${p}_member_${i}`,
        type: "feature",
        title: name,
        description: `Senior specialist with ${8 + i}+ years experience. Expert in ${brief.services[i % brief.services.length]}.`,
      });
      blocks.push({ id: `${p}_photo_${i}`, type: "gallery", caption: name, imageQuery: "professional portrait" });
    });
    return blocks;
  }

  if (plan.slug === "faq") {
    const qs = [
      ["What is your minimum investment?", "We typically work with clients starting at $500K investable assets."],
      ["Are you fiduciaries?", "Yes — we are legally bound to act in your best interest at all times."],
      ["How are you compensated?", "Transparent fee-only structure based on assets under advisement."],
      ["How often do we meet?", "Quarterly reviews with on-demand access to your advisor team."],
    ];
    qs.forEach(([q, a], i) => {
      blocks.push({ id: `${p}_faq_${i}`, type: "faq", question: q, answer: a });
    });
    return blocks;
  }

  blocks.push({ id: `${p}_contact`, type: "contact", title: "Get in touch", email: "hello@example.com", phone: "(555) 123-4567", address: "123 Main Street", hours: "Mon–Sat 9am–7pm" });
  blocks.push({ id: `${p}_text`, type: "text", title: "Visit us", text: brief.elevatorPitch });
  blocks.push({ id: `${p}_img`, type: "image", alt: "Location", imageQuery: "storefront location" });
  blocks.push({ id: `${p}_cta`, type: "cta", headline: brief.primaryCta, buttonText: brief.primaryCta });
  return blocks;
}
