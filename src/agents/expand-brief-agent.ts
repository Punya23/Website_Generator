import type { ExpandedBrief } from "../types.js";
import { ExpandedBriefSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { detectVertical } from "./theme-agent.js";

const EXPAND_SYSTEM = `You are a senior brand strategist. The user gives a 1-2 line business description.
Expand it into a rich creative brief for a full production website.

Output valid JSON only:
{
  "businessName": "extracted or inferred brand name",
  "tagline": "memorable 6-10 word tagline",
  "elevatorPitch": "2-3 sentence pitch",
  "expandedBrief": "3-4 paragraph detailed description: who they are, what they offer, why they're different, location/vibe if known",
  "targetAudience": "specific audience description",
  "services": ["6-10 specific services or offerings"],
  "differentiators": ["4-6 unique selling points"],
  "tone": "brand voice in 3-5 words",
  "primaryCta": "main call to action phrase",
  "secondaryCta": "optional secondary CTA"
}

Be specific to THIS business — never generic filler. Invent plausible details when missing (city, specialties, years in business) but keep them consistent.`;

function mockExpand(rawBrief: string, businessName?: string): ExpandedBrief {
  const v = detectVertical(rawBrief);
  const name = businessName ?? extractName(rawBrief, v);

  if (v === "salon") {
    return ExpandedBriefSchema.parse({
      businessName: name,
      tagline: "Where artistry meets effortless beauty",
      elevatorPitch: `${name} is Austin's destination for luxury hair artistry — from lived-in balayage to precision cuts, delivered by award-winning stylists in a serene, appointment-only studio.`,
      expandedBrief: `${name} opened with a simple belief: every client deserves a transformative salon experience, not a rushed appointment. Our stylists train internationally in color theory, precision cutting, and scalp health. We use premium, sustainable product lines and offer complimentary consultations for color corrections and major transformations. Located in the heart of Austin, our studio blends minimalist design with warm hospitality — think soft lighting, curated playlists, and refreshments while you unwind. Whether you're preparing for a wedding, refreshing your everyday look, or committing to a bold color change, we tailor every service to your hair type, lifestyle, and personal style.`,
      targetAudience: "Professionals and creatives aged 25-55 seeking premium hair services, willing to invest in quality color and cuts",
      services: [
        "Signature haircuts & styling",
        "Hand-painted balayage & highlights",
        "Full color transformations",
        "Keratin smoothing treatments",
        "Bridal & event styling",
        "Men's precision grooming",
        "Scalp treatments & deep conditioning",
        "Color correction specialists",
      ],
      differentiators: [
        "Appointment-only luxury experience",
        "Senior stylists with 10+ years experience",
        "Custom color formulas for every client",
        "Sustainable, salon-exclusive product lines",
        "Free consultation on first color service",
        "Same-day online booking",
      ],
      tone: "warm luxe approachable",
      primaryCta: "Book Your Appointment",
      secondaryCta: "View Our Work",
    });
  }

  if (v === "finserv") {
    return ExpandedBriefSchema.parse({
      businessName: name,
      tagline: "Clarity. Growth. Legacy.",
      elevatorPitch: `${name} partners with families and business owners to build lasting wealth through disciplined investment management, tax-aware planning, and fiduciary advice you can trust.`,
      expandedBrief: `For over two decades, ${name} has guided clients through market cycles with a philosophy rooted in transparency and long-term thinking. We don't chase trends — we build diversified portfolios aligned to your goals, risk tolerance, and timeline. Our team includes CFA charterholders, CFP professionals, and tax strategists who collaborate on every client relationship. From retirement income planning to business succession and estate coordination, we provide integrated advice under one roof. Clients choose us because we listen first, explain clearly, and measure success by your outcomes — not our AUM.`,
      targetAudience: "High-net-worth individuals, business owners, and pre-retirees with $500K+ investable assets",
      services: [
        "Investment management",
        "Retirement income planning",
        "Tax optimization strategies",
        "Estate & legacy planning",
        "Business succession planning",
        "Risk management & insurance review",
        "Charitable giving strategies",
        "Financial planning for executives",
      ],
      differentiators: [
        "Fiduciary standard — no product sales",
        "25+ years average advisor tenure",
        "$2B+ assets under advisement",
        "Integrated tax and investment team",
        "Quarterly personal review meetings",
        "Transparent fee-only structure",
      ],
      tone: "authoritative calm trusted",
      primaryCta: "Schedule a Consultation",
      secondaryCta: "Download Our Approach",
    });
  }

  return ExpandedBriefSchema.parse({
    businessName: name,
    tagline: "Excellence in every detail",
    elevatorPitch: `${name} delivers exceptional service built on expertise, integrity, and a relentless focus on client outcomes.`,
    expandedBrief: rawBrief + ". " + `${name} combines deep industry expertise with a client-first culture. Our team brings decades of collective experience and a commitment to measurable results. We invest in ongoing training, modern tools, and transparent communication so every client feels informed and confident.`,
    targetAudience: "Local and regional clients seeking professional, reliable service",
    services: ["Consultation", "Core service package", "Premium offering", "Support & maintenance", "Custom solutions", "Training & onboarding"],
    differentiators: ["Experienced team", "Client-first approach", "Proven track record", "Transparent pricing"],
    tone: "professional confident clear",
    primaryCta: "Get Started",
  });
}

function extractName(brief: string, vertical: string): string {
  const m = brief.match(/^([A-Z][A-Za-z0-9&'\s]{2,28}?)\s*[—–-]/);
  if (m?.[1]) return m[1].trim();
  const labels: Record<string, string> = { salon: "Studio", finserv: "Partners", default: "Co" };
  return `Premier ${labels[vertical] ?? "Co"}`;
}

export async function expandBrief(
  rawBrief: string,
  businessName?: string
): Promise<ExpandedBrief> {
  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        EXPAND_SYSTEM,
        `User input:\n${rawBrief}\n\n${businessName ? `Preferred business name: ${businessName}` : "Extract the business name from the input."}`,
        { jsonMode: true, temperature: 0.7, maxTokens: 4096 }
      );
      const parsed = ExpandedBriefSchema.parse(JSON.parse(raw));
      if (businessName) parsed.businessName = businessName;
      return parsed;
    } catch {
      // fallback
    }
  }
  return mockExpand(rawBrief, businessName);
}

export function briefToContext(brief: ExpandedBrief): string {
  return [
    `Name: ${brief.businessName}`,
    `Tagline: ${brief.tagline}`,
    `Pitch: ${brief.elevatorPitch}`,
    `Details: ${brief.expandedBrief}`,
    `Audience: ${brief.targetAudience}`,
    `Services: ${brief.services.join("; ")}`,
    `Differentiators: ${brief.differentiators.join("; ")}`,
    `Tone: ${brief.tone}`,
    `Primary CTA: ${brief.primaryCta}`,
  ].join("\n");
}
