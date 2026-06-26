"use client";

import useEmblaCarousel from "embla-carousel-react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Container,
  DisplayHeading,
  MagneticButton,
  MonoTag,
  Reveal,
  SectionDivider,
  SectionLabel,
  SplitRevealHeading,
  Stagger,
  StaggerItem,
} from "../primitives";
import { SectionIdProvider } from "../SectionContext";

type ImageField = { src?: string; alt?: string };
type CtaField = { label: string; href?: string };

function ImmersiveShell({
  id,
  templateId,
  mode,
  children,
  className = "",
  layoutVariant,
  divider,
}: {
  id?: string;
  templateId: string;
  mode?: string;
  children: React.ReactNode;
  className?: string;
  layoutVariant?: string;
  divider?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-8% 0px" });

  return (
    <SectionIdProvider id={id}>
      {divider ? <SectionDivider /> : null}
      <motion.section
        ref={ref}
        data-section={id}
        data-template={templateId}
        data-mode={mode}
        data-layout-variant={layoutVariant}
        className={`section-shell ${className}`}
        initial={reduce ? false : { opacity: 0.85, scale: 0.98 }}
        animate={inView ? { opacity: 1, scale: 1 } : undefined}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.section>
    </SectionIdProvider>
  );
}

function parseStatValue(raw: string): { num: number; prefix: string; suffix: string } {
  const match = raw.match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
  if (!match) return { num: 0, prefix: "", suffix: raw };
  return { num: parseFloat(match[2]), prefix: match[1], suffix: match[3] };
}

function AnimatedStat({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const { num, prefix, suffix } = parseStatValue(value);
  const [display, setDisplay] = useState(reduce ? value : `${prefix}0${suffix}`);

  useEffect(() => {
    if (!inView || reduce) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 1200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(num * eased);
      setDisplay(`${prefix}${current}${suffix}`);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduce, value, num, prefix, suffix]);

  return (
    <div ref={ref} className="text-center">
      <p className="font-display text-4xl font-bold text-text md:text-5xl">{display}</p>
      <p className="mt-2 text-sm uppercase tracking-widest text-muted">{label}</p>
    </div>
  );
}

export function HeroVideo(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  video?: { src?: string; poster?: ImageField };
  cta?: CtaField;
  layoutVariant?: string;
}) {
  return (
    <ImmersiveShell id={props.id} templateId="hero_video" mode="bleed" layoutVariant={props.layoutVariant} className="relative min-h-[75vh] overflow-hidden">
      <div className="absolute inset-0">
        {props.video?.src ? (
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            poster={props.video.poster?.src}
          >
            <source src={props.video.src} />
          </video>
        ) : props.video?.poster?.src ? (
          <img src={props.video.poster.src} alt={props.video.poster.alt ?? props.headline} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full mesh-gradient bg-accent/10" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-bg/30 to-transparent" />
      </div>
      <Container className="relative flex min-h-[75vh] flex-col justify-end pb-16 pt-32">
        <Reveal>
          {props.label ? <MonoTag>{props.label}</MonoTag> : null}
          <SplitRevealHeading text={props.headline} className="mt-4 max-w-3xl text-text" />
          {props.subcopy ? <p className="mt-4 max-w-xl text-lg text-muted">{props.subcopy}</p> : null}
          {props.cta ? (
            <div className="mt-8">
              <MagneticButton href={props.cta.href ?? "#contact"} className="bg-accent px-6 py-3 text-sm font-semibold text-white">
                {props.cta.label}
              </MagneticButton>
            </div>
          ) : null}
        </Reveal>
      </Container>
    </ImmersiveShell>
  );
}

export function TestimonialCarousel(props: {
  id?: string;
  label?: string;
  headline?: string;
  items: Array<{ quote: string; author: string; role?: string; avatar?: ImageField }>;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" });
  const [index, setIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <ImmersiveShell id={props.id} templateId="testimonial_carousel" mode="contained" className="py-section">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        {props.headline ? <DisplayHeading className="mt-2">{props.headline}</DisplayHeading> : null}
        <div className="relative mt-10 overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {props.items.map((item, i) => (
              <div key={i} className="min-w-0 flex-[0_0_100%] px-2 md:flex-[0_0_80%] lg:flex-[0_0_60%]">
                <div className="rounded-2xl border border-border bg-surface/80 p-8 backdrop-blur-sm md:p-10">
                  <p className="font-display text-xl leading-relaxed text-text md:text-2xl">&ldquo;{item.quote}&rdquo;</p>
                  <div className="mt-6 flex items-center gap-4">
                    {item.avatar?.src ? (
                      <img src={item.avatar.src} alt={item.author} className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                        {item.author.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-text">{item.author}</p>
                      {item.role ? <p className="text-sm text-muted">{item.role}</p> : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {props.items.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1}`}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-accent" : "w-2 bg-border"}`}
              onClick={() => emblaApi?.scrollTo(i)}
            />
          ))}
        </div>
      </Container>
    </ImmersiveShell>
  );
}

export function PortfolioCarousel(props: {
  id?: string;
  label?: string;
  headline?: string;
  slides: Array<{ title: string; category?: string; image?: ImageField }>;
}) {
  const [emblaRef] = useEmblaCarousel({ loop: true, align: "start", containScroll: "trimSnaps" });

  return (
    <ImmersiveShell id={props.id} templateId="portfolio_carousel" mode="bleed" className="py-section">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        {props.headline ? <DisplayHeading className="mt-2">{props.headline}</DisplayHeading> : null}
      </Container>
      <div className="mt-8 overflow-hidden pl-6 md:pl-[max(1.5rem,calc((100vw-var(--max-content))/2))]" ref={emblaRef}>
        <div className="flex gap-4">
          {props.slides.map((slide, i) => (
            <div key={i} className="min-w-0 flex-[0_0_85%] sm:flex-[0_0_55%] lg:flex-[0_0_40%]">
              <div className="group relative overflow-hidden rounded-2xl">
                {slide.image?.src ? (
                  <img
                    src={slide.image.src}
                    alt={slide.image.alt ?? slide.title}
                    className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="aspect-[4/5] w-full bg-accent/10" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                  {slide.category ? <p className="text-xs uppercase tracking-widest opacity-80">{slide.category}</p> : null}
                  <p className="mt-1 font-display text-xl font-semibold">{slide.title}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ImmersiveShell>
  );
}

export function BeforeAfter(props: {
  id?: string;
  label?: string;
  headline?: string;
  before: ImageField;
  after: ImageField;
  caption?: string;
}) {
  const [position, setPosition] = useState(50);

  return (
    <ImmersiveShell id={props.id} templateId="before_after" mode="contained" divider className="py-section">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        {props.headline ? <DisplayHeading className="mt-2">{props.headline}</DisplayHeading> : null}
        <div className="relative mt-8 aspect-[16/10] overflow-hidden rounded-2xl">
          {props.after.src ? (
            <img src={props.after.src} alt={props.after.alt ?? "After"} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-accent/20" />
          )}
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            {props.before.src ? (
              <img src={props.before.src} alt={props.before.alt ?? "Before"} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-muted/30" />
            )}
          </div>
          <input
            type="range"
            min={5}
            max={95}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            className="absolute inset-0 z-10 w-full cursor-ew-resize opacity-0"
            aria-label="Compare before and after"
          />
          <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-0.5 bg-white shadow-lg" style={{ left: `${position}%` }} />
          <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs text-white">Before</span>
          <span className="pointer-events-none absolute right-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs text-white">After</span>
        </div>
        {props.caption ? <p className="mt-4 text-center text-muted">{props.caption}</p> : null}
      </Container>
    </ImmersiveShell>
  );
}

export function PricingToggle(props: {
  id?: string;
  label?: string;
  headline?: string;
  monthlyLabel?: string;
  yearlyLabel?: string;
  layoutVariant?: string;
  tiers: Array<{
    name: string;
    monthlyPrice: string;
    yearlyPrice: string;
    description?: string;
    features?: string[];
    highlighted?: boolean;
    cta?: CtaField;
  }>;
}) {
  const [yearly, setYearly] = useState(false);
  const monthlyLabel = props.monthlyLabel ?? "Monthly";
  const yearlyLabel = props.yearlyLabel ?? "Yearly";
  const centered = (props.layoutVariant ?? "centered-stack") === "centered-stack";
  const headerAlign = centered ? "text-center" : "text-left";
  const toggleAlign = centered ? "justify-center" : "justify-start";

  return (
    <ImmersiveShell id={props.id} templateId="pricing_toggle" mode="contained" className="py-section mesh-gradient">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        {props.headline ? <DisplayHeading className={`mt-2 ${headerAlign}`}>{props.headline}</DisplayHeading> : null}
        <div className={`mt-6 flex ${toggleAlign}`}>
          <div className="inline-flex rounded-full border border-border bg-surface p-1">
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${!yearly ? "bg-accent text-white" : "text-muted"}`}
              onClick={() => setYearly(false)}
            >
              {monthlyLabel}
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${yearly ? "bg-accent text-white" : "text-muted"}`}
              onClick={() => setYearly(true)}
            >
              {yearlyLabel}
            </button>
          </div>
        </div>
        <Stagger className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {props.tiers.map((tier) => (
            <StaggerItem key={tier.name}>
              <div
                className={`flex h-full flex-col rounded-2xl border p-6 ${tier.highlighted ? "border-accent bg-surface shadow-xl" : "border-border bg-surface/80"}`}
              >
                <p className="font-semibold text-text">{tier.name}</p>
                <p className="mt-2 font-display text-3xl font-bold text-text">
                  {yearly ? tier.yearlyPrice : tier.monthlyPrice}
                </p>
                {tier.description ? <p className="mt-2 text-sm text-muted">{tier.description}</p> : null}
                {tier.features?.length ? (
                  <ul className="mt-4 flex-1 space-y-2 text-sm text-muted">
                    {tier.features.map((f) => (
                      <li key={f}>✓ {f}</li>
                    ))}
                  </ul>
                ) : null}
                {tier.cta ? (
                  <div className="mt-6">
                    <MagneticButton
                      href={tier.cta.href ?? "#contact"}
                      className={`w-full px-4 py-3 text-sm font-semibold ${tier.highlighted ? "bg-accent text-white" : "border border-border text-text"}`}
                    >
                      {tier.cta.label}
                    </MagneticButton>
                  </div>
                ) : null}
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </ImmersiveShell>
  );
}

export function StatsAnimated(props: {
  id?: string;
  label?: string;
  headline?: string;
  stats: Array<{ value: string; label: string }>;
}) {
  return (
    <ImmersiveShell id={props.id} templateId="stats_animated" mode="band" className="border-y border-border py-section">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        {props.headline ? <DisplayHeading className="mt-2 text-center">{props.headline}</DisplayHeading> : null}
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {props.stats.map((stat) => (
            <AnimatedStat key={stat.label} value={stat.value} label={stat.label} />
          ))}
        </div>
      </Container>
    </ImmersiveShell>
  );
}

export function NewsletterBand(props: {
  id?: string;
  headline: string;
  subcopy?: string;
  placeholder?: string;
  buttonLabel?: string;
}) {
  return (
    <ImmersiveShell id={props.id} templateId="newsletter_band" mode="band" className="border-t border-border bg-surface/60 py-section">
      <Container className="max-w-2xl text-center">
        <Reveal>
          <DisplayHeading as="h2">{props.headline}</DisplayHeading>
          {props.subcopy ? <p className="mt-3 text-muted">{props.subcopy}</p> : null}
          <form
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              placeholder={props.placeholder ?? "you@example.com"}
              className="rounded-full border border-border bg-bg px-5 py-3 text-sm outline-none focus:border-accent"
              aria-label="Email"
            />
            <MagneticButton className="bg-accent px-6 py-3 text-sm font-semibold text-white">
              {props.buttonLabel ?? "Subscribe"}
            </MagneticButton>
          </form>
        </Reveal>
      </Container>
    </ImmersiveShell>
  );
}
