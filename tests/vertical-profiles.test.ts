import { describe, it, expect } from "vitest";
import {
  inferVerticalProfile,
  mockPaletteForProfile,
  mockNavForProfile,
} from "../src/design/vertical-profiles.js";
import { syncPageToneWithBg } from "../src/agents/merge-design.js";

const baseBrief = {
  businessName: "Luxe Salon",
  tagline: "Refined beauty",
  elevatorPitch: "Premium salon services",
  expandedBrief: "A luxury hair salon and spa in downtown",
  targetAudience: "Professionals",
  services: ["Cut", "Color", "Spa"],
  differentiators: ["Craft", "Care", "Calm"],
  tone: "refined",
  primaryCta: "Book now",
};

describe("inferVerticalProfile", () => {
  it("classifies salon brief as luxury-dark", () => {
    const profile = inferVerticalProfile(baseBrief);
    expect(profile.profileId).toBe("luxury-dark");
    expect(profile.pageTone).toBe("dark");
    expect(profile.heroBias).toBe("hero_spotlight");
    expect(profile.grainOverlay).toBe(false);
  });

  it("classifies dental brief as clinical-light", () => {
    const profile = inferVerticalProfile({
      ...baseBrief,
      businessName: "Clear Smile Dental",
      expandedBrief: "Family dental clinic offering orthodontics and cleanings",
    });
    expect(profile.profileId).toBe("clinical-light");
    expect(profile.pageTone).toBe("light");
    expect(profile.grainOverlay).toBe(false);
  });

  it("reads profile from visualArchetype slug", () => {
    const profile = inferVerticalProfile(
      { ...baseBrief, expandedBrief: "Generic business" },
      { visualArchetype: "dental-clinical-light", compositionStrategy: "trust" }
    );
    expect(profile.profileId).toBe("clinical-light");
  });

  it("classifies finance brief as corporate-light", () => {
    const profile = inferVerticalProfile({
      ...baseBrief,
      businessName: "Harbor Wealth",
      expandedBrief: "Financial advisory and wealth management for families",
      services: ["Advisory", "Planning"],
      differentiators: ["Trust"],
    });
    expect(profile.profileId).toBe("corporate-light");
    expect(profile.pageTone).toBe("cool");
  });
});

describe("profile mocks", () => {
  it("luxury-dark palette uses dark background", () => {
    const profile = inferVerticalProfile(baseBrief);
    const palette = mockPaletteForProfile(profile, baseBrief.businessName);
    expect(palette.colors.bg).toBe("#0a0a0a");
    const nav = mockNavForProfile(profile);
    expect(nav.pageTone).toBe("dark");
  });
});

describe("syncPageToneWithBg", () => {
  it("forces dark pageTone on dark backgrounds", () => {
    expect(syncPageToneWithBg("light", "#0a0a0a")).toBe("dark");
  });

  it("preserves warm tone on light backgrounds", () => {
    expect(syncPageToneWithBg("warm", "#faf7f2")).toBe("warm");
  });
});
