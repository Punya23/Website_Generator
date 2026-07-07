"use client";

import { useReducedMotion } from "framer-motion";
import {
  Container,
  DisplayHeading,
  MagneticButton,
  MonoTag,
  Reveal,
  HeroReveal,
  SectionLabel,
  SplitHeroLayout,
  SplitRevealHeading,
} from "../primitives";
import {
  CursorSpotlight,
  GlassPanel,
  HorizontalScrollTrack,
  NoiseGradientBg,
  ScrollPinSection,
  TextScrub,
} from "../primitives/premium";
import { SectionIdProvider } from "../SectionContext";

type ImageField = { src?: string; alt?: string };
type CtaField = { label: string; href?: string };

function PremiumShell({
  id,
  templateId,
  mode,
  children,
  className = "",
  layoutVariant,
}: {
  id?: string;
  templateId: string;
  mode?: string;
  children: React.ReactNode;
  className?: string;
  layoutVariant?: string;
}) {
  return (
    <SectionIdProvider id={id}>
      <section
        data-section={id}
        data-template={templateId}
        data-mode={mode}
        data-layout-variant={layoutVariant}
        className={`section-shell ${className}`}
      >
        {children}
      </section>
    </SectionIdProvider>
  );
}

function HeroMedia({
  image,
  headline,
  className = "aspect-[4/5] max-h-[min(72vh,640px)]",
}: {
  image?: ImageField;
  headline: string;
  className?: string;
}) {
  return (
    <div className={`section-media ${className}`}>
      {image?.src ? (
        <img
          src={image.src}
          alt={image.alt ?? headline}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full min-h-[280px] w-full bg-accent/10" />
      )}
    </div>
  );
}

export function HeroSpotlight(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  image?: ImageField;
  cta?: CtaField;
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  mediaPosition?: "background" | "left" | "right";
}) {
  const rawVariant = props.layoutVariant ?? "full-bleed-left";
  const variant =
    rawVariant === "split-offset" || rawVariant === "default" ? "full-bleed-left" : rawVariant;
  const padY =
    props.density === "compact" ? "py-12 md:py-16" : props.density === "airy" ? "py-20 md:py-28" : "py-16 md:py-24";
  const reduce = useReducedMotion();
  const imageRight = props.mediaPosition !== "left";

  const copyBlock = (
    <HeroReveal>
      {props.label ? <MonoTag>{props.label}</MonoTag> : null}
      {reduce ? (
        <DisplayHeading as="h1" className="mt-4 max-w-2xl">
          {props.headline}
        </DisplayHeading>
      ) : (
        <SplitRevealHeading text={props.headline} as="h1" className="mt-4 max-w-2xl" />
      )}
      {props.subcopy ? <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{props.subcopy}</p> : null}
      {props.cta ? (
        <div className="mt-8">
          <MagneticButton
            href={props.cta.href ?? "/contact"}
            className="bg-accent px-8 py-3 text-sm font-semibold text-white"
          >
            {props.cta.label}
          </MagneticButton>
        </div>
      ) : null}
    </HeroReveal>
  );

  if (variant === "centered-stack") {
    return (
      <PremiumShell
        id={props.id}
        templateId="hero_spotlight"
        mode="bleed"
        layoutVariant={variant}
        className="relative overflow-hidden bg-bg"
      >
        <NoiseGradientBg strong className="absolute inset-0">
          <CursorSpotlight className="w-full" intensity={0.42}>
            <Container className={`${padY} text-center`}>
              <div className="mx-auto max-w-3xl">{copyBlock}</div>
              <div className="mx-auto mt-10 w-full max-w-md">
                <Reveal delay={0.08}>
                  <HeroMedia image={props.image} headline={props.headline} className="aspect-square max-h-[420px]" />
                </Reveal>
              </div>
            </Container>
          </CursorSpotlight>
        </NoiseGradientBg>
      </PremiumShell>
    );
  }

  return (
    <PremiumShell
      id={props.id}
      templateId="hero_spotlight"
      mode="bleed"
      layoutVariant={variant}
      className="relative overflow-hidden bg-bg"
    >
      <NoiseGradientBg strong className="absolute inset-0">
        <CursorSpotlight className="w-full" intensity={0.42}>
          <Container className={padY}>
            <SplitHeroLayout
              mediaRight={imageRight}
              copy={copyBlock}
              media={
                <Reveal delay={0.08}>
                  <HeroMedia image={props.image} headline={props.headline} />
                </Reveal>
              }
            />
          </Container>
        </CursorSpotlight>
      </NoiseGradientBg>
    </PremiumShell>
  );
}

export function ScrollShowcase(props: {
  id?: string;
  label?: string;
  headline: string;
  body?: string;
  steps?: Array<{ title: string; description: string }>;
  image?: ImageField;
  cta?: CtaField;
}) {
  const steps = props.steps ?? [];
  const media = props.image?.src ? (
    <img
      src={props.image.src}
      alt={props.image.alt ?? props.headline}
      className="aspect-[4/5] w-full rounded-xl object-cover shadow-xl"
    />
  ) : (
    <div className="aspect-[4/5] w-full rounded-xl bg-accent/10" />
  );

  return (
    <PremiumShell id={props.id} templateId="scroll_showcase" mode="contained" className="bg-bg">
      <Container>
        <ScrollPinSection media={media}>
          <div>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading as="h2" className="max-w-xl">
              {props.headline}
            </DisplayHeading>
            {props.body ? <TextScrub text={props.body} className="mt-6 max-w-lg text-lg text-muted" /> : null}
            <div className="mt-10 space-y-6">
              {steps.map((step, i) => (
                <GlassPanel key={i} className="border-border/40 bg-surface/80">
                  <p className="font-mono text-xs uppercase tracking-widest text-accent">0{i + 1}</p>
                  <h3 className="mt-2 font-display text-xl">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.description}</p>
                </GlassPanel>
              ))}
            </div>
            {props.cta ? (
              <div className="mt-8">
                <MagneticButton
                  href={props.cta.href ?? "/contact"}
                  className="bg-accent px-6 py-3 text-sm font-semibold text-white"
                >
                  {props.cta.label}
                </MagneticButton>
              </div>
            ) : null}
          </div>
        </ScrollPinSection>
      </Container>
    </PremiumShell>
  );
}

export function HorizontalGallery(props: {
  id?: string;
  label?: string;
  headline?: string;
  items: Array<{ title: string; subtitle?: string; image?: ImageField }>;
}) {
  return (
    <PremiumShell id={props.id} templateId="horizontal_gallery" mode="bleed" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-8">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <HorizontalScrollTrack>
          {props.items.map((item, i) => (
            <div
              key={i}
              className="w-[min(88vw,420px)] shrink-0 snap-center overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
            >
              {item.image?.src ? (
                <img src={item.image.src} alt={item.title} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="aspect-[4/3] w-full bg-accent/10" />
              )}
              <div className="p-5">
                <h3 className="font-display text-lg">{item.title}</h3>
                {item.subtitle ? <p className="mt-1 text-sm text-muted">{item.subtitle}</p> : null}
              </div>
            </div>
          ))}
        </HorizontalScrollTrack>
      </Container>
    </PremiumShell>
  );
}
