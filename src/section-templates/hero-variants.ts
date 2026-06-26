import type { SiteContext } from "../types.js";
import { pickFrom } from "../design/variation.js";

const HERO_TEMPLATES = [
  "hero_spotlight",
  "hero_editorial",
  "hero_split_cinematic",
  "hero_video",
] as const;

const HERO_LAYOUT_BY_TEMPLATE: Record<string, string[]> = {
  hero_spotlight: ["split-offset", "centered-stack", "full-bleed-left"],
  hero_editorial: ["full-bleed-left", "split-offset", "centered-stack"],
  hero_split_cinematic: ["default", "split-offset"],
  hero_video: ["default", "full-bleed-left"],
};

export function pickHomeHeroTemplate(ctx: SiteContext): string {
  const profile = ctx.verticalProfile;
  const seed = ctx.variationSeed ?? 0;
  const bias = profile?.heroBias;

  if (bias && HERO_TEMPLATES.includes(bias as (typeof HERO_TEMPLATES)[number])) {
    const alternates = HERO_TEMPLATES.filter((t) => t !== bias);
    const pool = [bias, ...alternates.slice(0, 2)];
    return pickFrom(seed, "home-hero", pool);
  }

  const dark = profile?.profileId === "luxury-dark" || profile?.profileId === "editorial-light";
  const pool = dark
    ? ["hero_spotlight", "hero_video", "hero_editorial"]
    : ["hero_split_cinematic", "hero_editorial", "hero_spotlight"];
  return pickFrom(seed, "home-hero", pool);
}

export function pickHeroLayoutVariant(templateId: string, seed: number | string): string {
  const variants = HERO_LAYOUT_BY_TEMPLATE[templateId] ?? ["default"];
  return pickFrom(seed, `hero-layout:${templateId}`, variants);
}

/** Typed shell used as base when optional LLM hero enhancement runs. */
export function heroVariantShellSource(templateId: string): string {
  if (templateId === "hero_spotlight") {
    return `"use client";

import { HeroSpotlight } from "@/components/sections";

type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  image?: { src?: string; alt?: string };
  cta?: { label: string; href?: string };
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
};

export default function CustomHomeHero(props: HeroProps) {
  return (
    <HeroSpotlight
      id={props.id}
      label={props.label}
      headline={props.headline ?? "Welcome"}
      subcopy={props.subcopy}
      image={props.image}
      cta={props.cta}
      layoutVariant={props.layoutVariant}
      density={props.density}
    />
  );
}
`;
  }

  if (templateId === "hero_video") {
    return `"use client";

import { HeroVideo } from "@/components/sections";

type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  video?: { poster?: { src?: string; alt?: string } };
  cta?: { label: string; href?: string };
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
};

export default function CustomHomeHero(props: HeroProps) {
  return (
    <HeroVideo
      id={props.id}
      label={props.label}
      headline={props.headline ?? "Welcome"}
      subcopy={props.subcopy}
      video={props.video}
      cta={props.cta}
      layoutVariant={props.layoutVariant}
      density={props.density}
    />
  );
}
`;
  }

  return `"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Container, DisplayHeading, MonoTag, PrimaryButton, Reveal } from "@/components/primitives";

type HeroProps = {
  id?: string;
  label?: string;
  headline?: string;
  subcopy?: string;
  body?: string;
  image?: { src?: string; alt?: string };
  cta?: { label: string; href?: string };
};

export default function CustomHomeHero(props: HeroProps) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const sub = props.subcopy ?? props.body ?? "";

  return (
    <section id={props.id} ref={ref} className="relative min-h-[88vh] overflow-hidden bg-bg">
      <motion.div style={{ y }} className="absolute inset-0 opacity-90">
        {props.image?.src ? (
          <img src={props.image.src} alt={props.image.alt ?? ""} className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-accent/10" />
        )}
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-transparent" />
      <Container className="relative z-10 flex min-h-[88vh] items-end pb-20 pt-32 md:items-center md:pb-28">
        <div className="max-w-2xl md:translate-x-6">
          <Reveal>
            {props.label ? <MonoTag>{props.label}</MonoTag> : null}
            <DisplayHeading as="h1" className="text-display leading-tight">{props.headline ?? "Welcome"}</DisplayHeading>
            {sub ? <p className="mt-5 max-w-lg text-lg text-muted">{sub}</p> : null}
            {props.cta ? (
              <div className="mt-8">
                <PrimaryButton href={props.cta.href ?? "/contact"}>{props.cta.label}</PrimaryButton>
              </div>
            ) : null}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
`;
}
