"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import {
  Container,
  DisplayHeading,
  MonoTag,
  PrimaryButton,
  Reveal,
  SectionLabel,
  Stagger,
  StaggerItem,
} from "../primitives";

type ImageField = { src?: string; alt?: string };
type CtaField = { label: string; href?: string };

function SectionShell({
  id,
  templateId,
  mode,
  children,
  className = "",
}: {
  id?: string;
  templateId: string;
  mode?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-section={id}
      data-template={templateId}
      data-mode={mode}
      className={`section-shell ${className}`}
    >
      {children}
    </section>
  );
}

export function HeroEditorial(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  image?: ImageField;
  cta?: CtaField;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);

  return (
    <SectionShell id={props.id} templateId="hero_editorial" mode="bleed" className="relative min-h-[70vh] overflow-hidden">
      <div ref={ref} className="absolute inset-0">
        {props.image?.src ? (
          <motion.img
            src={props.image.src}
            alt={props.image.alt ?? props.headline}
            className="h-full w-full object-cover"
            style={reduce ? undefined : { y }}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent/30 to-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
      </div>
      <Container className="relative z-10 flex min-h-[70vh] flex-col justify-end pb-16 pt-32">
        <Reveal>
          {props.label ? <MonoTag>{props.label}</MonoTag> : null}
          <DisplayHeading as="h1" className="mt-4 max-w-4xl text-white">
            {props.headline}
          </DisplayHeading>
          {props.subcopy ? <p className="mt-4 max-w-2xl text-lg text-white/85">{props.subcopy}</p> : null}
          {props.cta ? (
            <div className="mt-8">
              <PrimaryButton href={props.cta.href ?? "#contact"}>{props.cta.label}</PrimaryButton>
            </div>
          ) : null}
        </Reveal>
      </Container>
    </SectionShell>
  );
}

export function HeroSplitCinematic(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  body?: string;
  image?: ImageField;
  cta?: CtaField;
}) {
  return (
    <SectionShell id={props.id} templateId="hero_split_cinematic" mode="bleed">
      <div className="grid min-h-[60vh] lg:grid-cols-2">
        <div className="flex flex-col justify-center bg-surface px-8 py-16 lg:px-16">
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading as="h1">{props.headline}</DisplayHeading>
            {props.subcopy ? <p className="mt-4 text-lg text-muted">{props.subcopy}</p> : null}
            {props.body ? <p className="mt-4 text-muted">{props.body}</p> : null}
            {props.cta ? (
              <div className="mt-8">
                <PrimaryButton href={props.cta.href ?? "#"}>{props.cta.label}</PrimaryButton>
              </div>
            ) : null}
          </Reveal>
        </div>
        <div className="relative min-h-[320px]">
          {props.image?.src ? (
            <img src={props.image.src} alt={props.image.alt ?? ""} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-accent/10" />
          )}
        </div>
      </div>
    </SectionShell>
  );
}

export function IntroStatement(props: { id?: string; label?: string; headline: string; body: string }) {
  return (
    <SectionShell id={props.id} templateId="intro_statement" mode="editorial" className="py-section">
      <Container>
        <Reveal>
          {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
          <DisplayHeading className="max-w-4xl">{props.headline}</DisplayHeading>
          <p className="mt-6 max-w-3xl text-xl leading-relaxed text-muted">{props.body}</p>
        </Reveal>
      </Container>
    </SectionShell>
  );
}

export function StatsMarquee(props: { id?: string; label?: string; stats: Array<{ value: string; label: string }> }) {
  return (
    <SectionShell id={props.id} templateId="stats_marquee" mode="band" className="border-y border-border bg-surface/50 py-12">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        <Stagger className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {props.stats.map((s, i) => (
            <StaggerItem key={i} className="border-l-2 border-accent pl-6">
              <div className="font-display text-4xl font-bold text-accent">{s.value}</div>
              <div className="mt-1 text-sm text-muted">{s.label}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}

export function ServicesShowcase(props: {
  id?: string;
  label?: string;
  headline: string;
  paragraphs: string[];
  image?: ImageField;
  cta?: CtaField;
}) {
  return (
    <SectionShell id={props.id} templateId="services_showcase" mode="contained" className="py-section">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading>{props.headline}</DisplayHeading>
            <div className="mt-6 space-y-4">
              {props.paragraphs.map((p, i) => (
                <p key={i} className="text-muted leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
            {props.cta ? (
              <div className="mt-8">
                <PrimaryButton href={props.cta.href ?? "#contact"}>{props.cta.label}</PrimaryButton>
              </div>
            ) : null}
          </Reveal>
          <Reveal delay={0.1}>
            {props.image?.src ? (
              <img
                src={props.image.src}
                alt={props.image.alt ?? props.headline}
                className="aspect-[4/5] w-full rounded-sm object-cover shadow-2xl"
              />
            ) : (
              <div className="aspect-[4/5] w-full rounded-sm bg-accent/10" />
            )}
          </Reveal>
        </div>
      </Container>
    </SectionShell>
  );
}

export function FeatureBento(props: {
  id?: string;
  label?: string;
  headline?: string;
  items: Array<{ title: string; description: string; image?: ImageField; span?: string }>;
}) {
  return (
    <SectionShell id={props.id} templateId="feature_bento" mode="contained" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-10">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <Stagger className="grid auto-rows-[minmax(180px,auto)] gap-4 md:grid-cols-4">
          {props.items.map((item, i) => (
            <StaggerItem
              key={i}
              className={`surface-elevated overflow-hidden rounded-lg p-6 ${
                item.span === "wide" ? "md:col-span-2" : item.span === "large" ? "md:col-span-2 md:row-span-2" : ""
              }`}
            >
              {item.image?.src ? (
                <img src={item.image.src} alt="" className="mb-4 h-32 w-full rounded object-cover" />
              ) : null}
              <h3 className="font-display text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}

export function PortfolioStrip(props: {
  id?: string;
  label?: string;
  headline?: string;
  projects: Array<{ title: string; category?: string; year?: string; image?: ImageField }>;
}) {
  return (
    <SectionShell id={props.id} templateId="portfolio_strip" mode="contained" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-10">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {props.projects.map((p, i) => (
            <StaggerItem key={i} className="group">
              <MonoTag>{String(i + 1).padStart(2, "0")}</MonoTag>
              {p.image?.src ? (
                <img src={p.image.src} alt={p.title} className="mt-3 aspect-[4/3] w-full rounded-sm object-cover" />
              ) : (
                <div className="mt-3 aspect-[4/3] w-full rounded-sm bg-accent/10" />
              )}
              <h3 className="mt-4 font-display text-lg">{p.title}</h3>
              <p className="text-sm text-muted">
                {[p.category, p.year].filter(Boolean).join(" · ")}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}

export function TestimonialFeatured(props: {
  id?: string;
  label?: string;
  quote: string;
  author: string;
  role?: string;
}) {
  return (
    <SectionShell id={props.id} templateId="testimonial_featured" mode="editorial" className="py-section">
      <Container>
        <Reveal>
          {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
          <blockquote className="max-w-4xl font-display text-3xl leading-snug md:text-4xl">
            &ldquo;{props.quote}&rdquo;
          </blockquote>
          <cite className="mt-8 block not-italic text-accent">
            — {props.author}
            {props.role ? `, ${props.role}` : ""}
          </cite>
        </Reveal>
      </Container>
    </SectionShell>
  );
}

export function PricingTiers(props: {
  id?: string;
  label?: string;
  headline?: string;
  tiers: Array<{
    name: string;
    price: string;
    period?: string;
    description?: string;
    features?: string[];
    highlighted?: boolean;
    cta?: CtaField;
  }>;
}) {
  return (
    <SectionShell id={props.id} templateId="pricing_tiers" mode="contained" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-10 text-center">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <Stagger className="grid gap-6 md:grid-cols-3">
          {props.tiers.map((tier, i) => (
            <StaggerItem
              key={i}
              className={`rounded-xl p-8 ${tier.highlighted ? "surface-elevated ring-2 ring-accent" : "border border-border"}`}
            >
              <h3 className="font-display text-xl">{tier.name}</h3>
              <div className="mt-4 font-display text-4xl font-bold text-accent">
                {tier.price}
                {tier.period ? <span className="text-base font-normal text-muted">/{tier.period}</span> : null}
              </div>
              {tier.description ? <p className="mt-3 text-sm text-muted">{tier.description}</p> : null}
              {tier.features?.length ? (
                <ul className="mt-6 space-y-2 text-sm text-muted">
                  {tier.features.map((f, j) => (
                    <li key={j}>• {f}</li>
                  ))}
                </ul>
              ) : null}
              {tier.cta ? (
                <div className="mt-8">
                  <PrimaryButton href={tier.cta.href ?? "#"}>{tier.cta.label}</PrimaryButton>
                </div>
              ) : null}
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}

export function FaqAccordion(props: {
  id?: string;
  label?: string;
  headline?: string;
  items: Array<{ question: string; answer: string }>;
}) {
  return (
    <SectionShell id={props.id} templateId="faq_accordion" mode="contained" className="py-section">
      <Container className="max-w-3xl">
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-8">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <div className="divide-y divide-border">
          {props.items.map((item, i) => (
            <details key={i} className="group py-4">
              <summary className="cursor-pointer list-none font-display text-lg font-medium marker:content-none">
                {item.question}
              </summary>
              <p className="mt-3 text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </SectionShell>
  );
}

export function CtaBand(props: { id?: string; headline: string; subcopy?: string; cta: CtaField }) {
  return (
    <SectionShell
      id={props.id}
      templateId="cta_band"
      mode="band"
      className="bg-gradient-to-br from-accent to-accent/80 py-20 text-white"
    >
      <Container className="text-center">
        <Reveal>
          <DisplayHeading className="text-white">{props.headline}</DisplayHeading>
          {props.subcopy ? <p className="mx-auto mt-4 max-w-2xl text-white/90">{props.subcopy}</p> : null}
          <div className="mt-8">
            <a
              href={props.cta.href ?? "#contact"}
              className="inline-flex rounded-full bg-white px-8 py-3 font-semibold text-accent"
            >
              {props.cta.label}
            </a>
          </div>
        </Reveal>
      </Container>
    </SectionShell>
  );
}

export function ContactSplit(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  email?: string;
  phone?: string;
  address?: string;
  hours?: string;
  formFields?: Array<{ label: string; type: string; required?: boolean; options?: string[] }>;
  submitLabel?: string;
}) {
  return (
    <SectionShell id={props.id} templateId="contact_split" mode="contained" className="py-section">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading>{props.headline}</DisplayHeading>
            {props.subcopy ? <p className="mt-4 text-muted">{props.subcopy}</p> : null}
            <div className="mt-8 space-y-3 text-muted">
              {props.email ? <p>✉ {props.email}</p> : null}
              {props.phone ? <p>☎ {props.phone}</p> : null}
              {props.address ? <p>📍 {props.address}</p> : null}
              {props.hours ? <p>🕐 {props.hours}</p> : null}
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              {(props.formFields ?? [
                { label: "Name", type: "text", required: true },
                { label: "Email", type: "email", required: true },
                { label: "Message", type: "textarea" },
              ]).map((field, i) => (
                <label key={i} className="block">
                  <span className="text-sm font-medium">{field.label}</span>
                  {field.type === "textarea" ? (
                    <textarea className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2" rows={4} />
                  ) : field.type === "select" ? (
                    <select className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2">
                      {field.options?.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      required={field.required}
                      className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2"
                    />
                  )}
                </label>
              ))}
              <button type="submit" className="rounded-full bg-accent px-6 py-3 font-semibold text-white">
                {props.submitLabel ?? "Send"}
              </button>
            </form>
          </Reveal>
        </div>
      </Container>
    </SectionShell>
  );
}

export function LogoMarquee(props: { id?: string; label?: string; logos: Array<{ name: string; src?: string }> }) {
  return (
    <SectionShell id={props.id} templateId="logo_marquee" mode="band" className="overflow-hidden border-y border-border py-10">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        <div className="flex animate-marquee gap-12 whitespace-nowrap">
          {[...props.logos, ...props.logos].map((logo, i) => (
            <span key={i} className="font-display text-lg text-muted/70">
              {logo.name}
            </span>
          ))}
        </div>
      </Container>
    </SectionShell>
  );
}

export function TeamGrid(props: {
  id?: string;
  label?: string;
  headline?: string;
  members: Array<{ name: string; role: string; bio?: string; image?: ImageField }>;
}) {
  return (
    <SectionShell id={props.id} templateId="team_grid" mode="contained" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-10">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <Stagger className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {props.members.map((m, i) => (
            <StaggerItem key={i}>
              {m.image?.src ? (
                <img src={m.image.src} alt={m.name} className="aspect-square w-full rounded-sm object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-sm bg-accent/10" />
              )}
              <h3 className="mt-4 font-display text-lg">{m.name}</h3>
              <p className="text-sm text-accent">{m.role}</p>
              {m.bio ? <p className="mt-2 text-sm text-muted">{m.bio}</p> : null}
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}

export function GalleryMasonry(props: {
  id?: string;
  label?: string;
  headline?: string;
  images: Array<{ src?: string; alt?: string; caption?: string }>;
}) {
  return (
    <SectionShell id={props.id} templateId="gallery_masonry" mode="bleed" className="py-section">
      <Container>
        {props.headline ? (
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="mb-10">{props.headline}</DisplayHeading>
          </Reveal>
        ) : null}
        <Stagger className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {props.images.map((img, i) => (
            <StaggerItem key={i} className="mb-4 break-inside-avoid">
              {img.src ? (
                <img src={img.src} alt={img.alt ?? ""} className="w-full rounded-sm object-cover" />
              ) : (
                <div className="aspect-[3/4] w-full rounded-sm bg-accent/10" />
              )}
              {img.caption ? <p className="mt-2 text-sm text-muted">{img.caption}</p> : null}
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </SectionShell>
  );
}
