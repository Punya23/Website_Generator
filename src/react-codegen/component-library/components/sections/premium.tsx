"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Container,
  DisplayHeading,
  MagneticButton,
  MonoTag,
  Reveal,
  SectionLabel,
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
  const variant = props.layoutVariant ?? "split-offset";
  const minH =
    props.density === "compact" ? "min-h-[70vh]" : props.density === "airy" ? "min-h-[92vh]" : "min-h-[85vh]";
  const reduce = useReducedMotion();
  const imageRight = props.mediaPosition !== "left";

  const copyBlock = (
    <Reveal>
      {props.label ? <MonoTag>{props.label}</MonoTag> : null}
      {reduce ? (
        <DisplayHeading as="h1" className="mt-4 max-w-3xl">
          {props.headline}
        </DisplayHeading>
      ) : (
        <SplitRevealHeading text={props.headline} as="h1" className="mt-4 max-w-3xl" />
      )}
      {props.subcopy ? <p className="mt-5 max-w-xl text-lg text-muted">{props.subcopy}</p> : null}
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
    </Reveal>
  );

  const imageBlock = (
    <Reveal delay={0.08}>
      {props.image?.src ? (
        <motion.img
          src={props.image.src}
          alt={props.image.alt ?? props.headline}
          className={`aspect-[4/5] w-full rounded-2xl object-cover shadow-2xl ${variant === "split-offset" ? "lg:translate-y-6" : ""}`}
          whileHover={{ scale: 1.02 }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
        />
      ) : (
        <div className="aspect-[4/5] w-full rounded-2xl bg-accent/10" />
      )}
    </Reveal>
  );

  if (variant === "centered-stack") {
    return (
      <PremiumShell
        id={props.id}
        templateId="hero_spotlight"
        mode="bleed"
        layoutVariant={variant}
        className={`relative overflow-hidden bg-bg ${minH}`}
      >
        <NoiseGradientBg strong className="absolute inset-0">
          <CursorSpotlight className={`flex ${minH} w-full`} intensity={0.42}>
            <Container className={`flex ${minH} flex-col items-center justify-center text-center`}>
              {copyBlock}
              <div className="mt-10 max-w-md">{imageBlock}</div>
            </Container>
          </CursorSpotlight>
        </NoiseGradientBg>
      </PremiumShell>
    );
  }

  if (variant === "full-bleed-left") {
    return (
      <PremiumShell
        id={props.id}
        templateId="hero_spotlight"
        mode="bleed"
        layoutVariant={variant}
        className={`relative overflow-hidden bg-bg ${minH}`}
      >
        <NoiseGradientBg strong className="absolute inset-0">
          <CursorSpotlight className={`flex ${minH} w-full`} intensity={0.42}>
            <Container className={`flex ${minH} items-center py-16 md:py-24`}>
              <div className={`grid w-full items-center gap-10 ${imageRight ? "lg:grid-cols-[1.15fr_0.85fr]" : "lg:grid-cols-[0.85fr_1.15fr]"}`}>
                {imageRight ? (
                  <>
                    {copyBlock}
                    {imageBlock}
                  </>
                ) : (
                  <>
                    {imageBlock}
                    {copyBlock}
                  </>
                )}
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
      className={`relative overflow-hidden bg-bg ${minH}`}
    >
      <NoiseGradientBg strong className="absolute inset-0">
        <CursorSpotlight className={`flex ${minH} w-full`} intensity={0.42}>
          <Container className={`flex ${minH} items-center py-16 md:py-24`}>
            <div className={`grid w-full items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] ${imageRight ? "" : "[&>*:first-child]:order-2"}`}>
              {copyBlock}
              <div className={imageRight ? "relative lg:-mr-12 lg:translate-y-8" : "relative lg:-ml-12 lg:translate-y-8"}>
                {imageBlock}
              </div>
            </div>
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
              className="w-[min(85vw,420px)] shrink-0 snap-center overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
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
