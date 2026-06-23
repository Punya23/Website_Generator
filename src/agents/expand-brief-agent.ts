import type { ExpandedBrief } from "../types.js";
import { ExpandedBriefSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { allowMocks, requireLlm } from "../util/llm-required.js";

const EXPAND_SYSTEM = `You are a senior brand strategist. The user gives a 1-2 line business description.
Expand it into a rich creative brief for a full production website — ANY industry, ANY scale.

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

Be specific to THIS business — never generic filler. Invent plausible details when missing but keep them consistent.`;

function extractName(brief: string): string {
  const beforeDash = brief.match(/^([A-Za-z0-9][A-Za-z0-9\s.'&]{1,40}?)\s*[-—:]/);
  if (beforeDash?.[1]) return beforeDash[1].trim();
  const words = brief.split(/\s+/).filter((w) => w.length > 2).slice(0, 2);
  if (words.length) {
    return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  return "Your Business";
}

function mockExpand(rawBrief: string, businessName?: string): ExpandedBrief {
  const name = businessName ?? extractName(rawBrief);
  const snippet = rawBrief.length > 120 ? rawBrief.slice(0, 117) + "..." : rawBrief;

  return ExpandedBriefSchema.parse({
    businessName: name,
    tagline: "Crafted for those who expect more",
    elevatorPitch: `${name} delivers exceptional experiences rooted in expertise, care, and attention to every detail that matters to clients.`,
    expandedBrief: `${snippet}\n\n${name} was built around a clear promise: do the work properly, communicate honestly, and leave every client better off than they arrived. Our team combines deep craft with modern tools and a relentless focus on outcomes. Whether you're visiting for the first time or returning for years, you'll find a consistent standard — thoughtful service, transparent pricing, and results you can feel confident about.`,
    targetAudience: "Local and regional clients who value quality, reliability, and a professional experience",
    services: [
      "Consultation & discovery",
      "Core offering",
      "Premium service tier",
      "Maintenance & support",
      "Custom packages",
      "Express / same-day options",
      "Membership & loyalty programs",
      "Corporate & group services",
    ],
    differentiators: [
      "Experienced, dedicated team",
      "Client-first culture",
      "Transparent pricing",
      "Modern facilities & tools",
      "Consistently high reviews",
      "Flexible booking",
    ],
    tone: "professional warm confident",
    primaryCta: "Get Started",
    secondaryCta: "Learn More",
  });
}

export async function expandBrief(
  rawBrief: string,
  businessName?: string
): Promise<ExpandedBrief> {
  requireLlm("expand brief");

  if (llm.isAvailable) {
    try {
      const raw = await llm.chat(
        EXPAND_SYSTEM,
        `User input:\n${rawBrief}\n\n${businessName ? `Preferred business name: ${businessName}` : "Extract the business name from the input."}`,
        { jsonMode: true, temperature: 0.7, maxTokens: 4096 }
      );
      return ExpandedBriefSchema.parse(JSON.parse(raw));
    } catch (err) {
      if (!allowMocks()) throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!allowMocks()) throw new Error("Expand brief failed");
  return mockExpand(rawBrief, businessName);
}

export function briefToContext(brief: ExpandedBrief): string {
  return `BUSINESS: ${brief.businessName}
TAGLINE: ${brief.tagline}
PITCH: ${brief.elevatorPitch}
BRIEF: ${brief.expandedBrief}
AUDIENCE: ${brief.targetAudience}
SERVICES: ${brief.services.join(", ")}
DIFFERENTIATORS: ${brief.differentiators.join(", ")}
TONE: ${brief.tone}
PRIMARY CTA: ${brief.primaryCta}`;
}
