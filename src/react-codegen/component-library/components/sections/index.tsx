"use client";

import {
  Container,
  DisplayHeading,
  MonoTag,
  PrimaryButton,
  SplitHeroLayout,
  CardGrid,
  SectionBody,
  Reveal,
  HeroReveal,
  SectionLabel,
  Stagger,
  StaggerItem,
} from "../primitives";
import { Media } from "../primitives/Media";
import { SectionIdProvider } from "../SectionContext";

type ImageField = { src?: string; alt?: string };
type CtaField = { label: string; href?: string };

function SectionShell({
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

type LayoutProps = {
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  mediaPosition?: "background" | "left" | "right";
};

export function HeroEditorial(props: {
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
  const variant = rawVariant === "split-offset" ? "split-offset" : rawVariant;
  const minH = props.density === "compact" ? "min-h-[55vh]" : props.density === "airy" ? "min-h-[80vh]" : "min-h-[70vh]";

  if (variant === "centered-stack") {
    return (
      <SectionShell id={props.id} templateId="hero_editorial" mode="bleed" layoutVariant={variant} className={`${minH} bg-bg`}>
        <Container className="py-section text-center">
          <SectionBody className={`flex ${minH} flex-col items-center justify-center`}>
            <HeroReveal>
              {props.label ? <MonoTag>{props.label}</MonoTag> : null}
              <DisplayHeading as="h1" className="mt-4 max-w-3xl mx-auto">{props.headline}</DisplayHeading>
              {props.subcopy ? <p className="mt-4 max-w-xl mx-auto text-lg text-muted">{props.subcopy}</p> : null}
              {props.cta ? (
                <div className="mt-8">
                  <PrimaryButton href={props.cta.href ?? "#contact"}>{props.cta.label}</PrimaryButton>
                </div>
              ) : null}
            </HeroReveal>
          </SectionBody>
        </Container>
      </SectionShell>
    );
  }

  if (variant === "full-bleed-left" && props.image?.src) {
    return (
      <SectionShell id={props.id} templateId="hero_editorial" mode="bleed" layoutVariant={variant} className="overflow-hidden bg-bg py-section">
        <Container>
          <SplitHeroLayout
            mediaRight={props.mediaPosition !== "left"}
            copy={
              <HeroReveal>
                {props.label ? <MonoTag>{props.label}</MonoTag> : null}
                <DisplayHeading as="h1" className="mt-4">{props.headline}</DisplayHeading>
                {props.subcopy ? <p className="mt-4 text-lg text-muted">{props.subcopy}</p> : null}
                {props.cta ? (
                  <div className="mt-8">
                    <PrimaryButton href={props.cta.href ?? "#contact"}>{props.cta.label}</PrimaryButton>
                  </div>
                ) : null}
              </HeroReveal>
            }
            media={
              <div className="section-media aspect-[4/5] max-h-[min(72vh,640px)]">
                <img src={props.image.src} alt={props.image.alt ?? props.headline} className="h-full w-full rounded-2xl object-cover shadow-2xl" />
              </div>
            }
          />
        </Container>
      </SectionShell>
    );
  }

  return (
    <SectionShell id={props.id} templateId="hero_editorial" mode="bleed" layoutVariant={variant === "default" ? "split-offset" : variant} className="hero-split-offset overflow-hidden bg-bg py-section">
      <Container>
        <SplitHeroLayout
          mediaRight={props.mediaPosition !== "left"}
          copy={
            <HeroReveal>
              {props.label ? <MonoTag>{props.label}</MonoTag> : null}
              <DisplayHeading as="h1" className="mt-4">{props.headline}</DisplayHeading>
              {props.subcopy ? <p className="mt-4 text-lg text-muted">{props.subcopy}</p> : null}
              {props.cta ? (
                <div className="mt-8">
                  <PrimaryButton href={props.cta.href ?? "#contact"}>{props.cta.label}</PrimaryButton>
                </div>
              ) : null}
            </HeroReveal>
          }
          media={
            <div className="section-media aspect-[4/5] max-h-[min(72vh,640px)]">
              {props.image?.src ? (
                <img src={props.image.src} alt={props.image.alt ?? props.headline} className="h-full w-full rounded-2xl object-cover shadow-2xl" />
              ) : (
                <div className="h-full min-h-[280px] w-full rounded-2xl bg-accent/10" />
              )}
            </div>
          }
        />
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
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  mediaPosition?: "background" | "left" | "right";
}) {
  const variant =
    props.layoutVariant === "split-offset" ? "split-offset" : props.layoutVariant === "centered-stack" ? "centered-stack" : "full-bleed-left";
  const mediaRight = props.mediaPosition !== "left";
  const minH = props.density === "compact" ? "min-h-[50vh]" : "min-h-[60vh]";

  const copyBlock = (
    <HeroReveal>
      {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
      <DisplayHeading as="h1">{props.headline}</DisplayHeading>
      {props.subcopy ? <p className="mt-4 text-lg text-muted">{props.subcopy}</p> : null}
      {props.body ? <p className="mt-4 text-muted">{props.body}</p> : null}
      {props.cta ? (
        <div className="mt-8">
          <PrimaryButton href={props.cta.href ?? "#"}>{props.cta.label}</PrimaryButton>
        </div>
      ) : null}
    </HeroReveal>
  );

  const mediaBlock = (
    <div className="section-media aspect-video max-h-[min(50vh,480px)]">
      {props.image?.src ? (
        <Media src={props.image.src!} alt={props.image.alt ?? props.headline ?? "Hero image"} className="h-full w-full rounded-xl object-cover shadow-xl" />
      ) : (
        <div className="h-full min-h-[240px] w-full rounded-xl bg-accent/10" />
      )}
    </div>
  );

  return (
    <SectionShell id={props.id} templateId="hero_split_cinematic" mode="bleed" layoutVariant={variant} className="overflow-hidden py-section">
      <Container>
        <SplitHeroLayout mediaRight={mediaRight} className={minH} copy={copyBlock} media={mediaBlock} />
      </Container>
    </SectionShell>
  );
}

export function IntroStatement(props: { id?: string; label?: string; headline: string; body: string }) {
  return (
    <SectionShell id={props.id} templateId="intro_statement" mode="editorial" className="py-section">
      <Container>
        <SectionBody>
          <Reveal>
            {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
            <DisplayHeading className="max-w-4xl">{props.headline}</DisplayHeading>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-muted">{props.body}</p>
          </Reveal>
        </SectionBody>
      </Container>
    </SectionShell>
  );
}

export function StatsMarquee(props: { id?: string; label?: string; stats: Array<{ value: string; label: string }> }) {
  return (
    <SectionShell id={props.id} templateId="stats_marquee" mode="band" className="border-y border-border bg-surface/50 py-12">
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        <Stagger className="card-grid sm:grid-cols-2 lg:grid-cols-4">
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
        <SplitHeroLayout
          mediaRight
          copy={
            <Reveal>
              {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
              <DisplayHeading>{props.headline}</DisplayHeading>
              <div className="mt-6 space-y-4">
                {props.paragraphs.map((p, i) => (
                  <p key={i} className="leading-relaxed text-muted">
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
          }
          media={
            <Reveal delay={0.1}>
              <div className="section-media aspect-[4/5] max-h-[min(72vh,560px)]">
                {props.image?.src ? (
                  <img
                    src={props.image.src}
                    alt={props.image.alt ?? props.headline}
                    className="h-full w-full rounded-sm object-cover shadow-2xl"
                  />
                ) : (
                  <div className="h-full min-h-[280px] w-full rounded-sm bg-accent/10" />
                )}
              </div>
            </Reveal>
          }
        />
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
        <Stagger className="card-grid auto-rows-[minmax(180px,auto)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {props.items.map((item, i) => (
            <StaggerItem
              key={i}
              className={`surface-elevated overflow-hidden rounded-lg p-6 ${
                item.span === "wide" ? "sm:col-span-2" : item.span === "large" ? "sm:col-span-2 sm:row-span-2 lg:col-span-2 lg:row-span-2" : ""
              }`}
            >
              {item.image?.src ? (
                <Media src={item.image.src!} alt={item.title ?? "Feature image"} className="mb-4 h-32 w-full rounded object-cover" />
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
        <Stagger className="card-grid sm:grid-cols-2 lg:grid-cols-3">
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
        <Stagger className="card-grid sm:grid-cols-2 lg:grid-cols-3">
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
      <Container narrow="md">
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

export function CtaBand(props: {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  cta: CtaField;
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
}) {
  const variant = props.layoutVariant ?? "centered-stack";
  const pad =
    props.density === "compact" || variant === "band-compact"
      ? "py-12"
      : props.density === "airy" || variant === "band-wide"
        ? "py-28 md:py-32"
        : "py-20";
  const isCentered = variant === "centered-stack" || variant === "default";
  const narrowSize = isCentered ? "md" : variant === "band-wide" ? "lg" : "sm";

  return (
    <SectionShell
      id={props.id}
      templateId="cta_band"
      mode="band"
      layoutVariant={variant}
      className={`cta-gradient ${pad} text-white`}
    >
      <Container narrow={narrowSize} className={isCentered ? "text-center" : "text-left"}>
        <Reveal>
          {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
          <DisplayHeading className={`text-white ${variant === "band-wide" ? "text-display" : ""}`}>
            {props.headline}
          </DisplayHeading>
          {props.subcopy ? (
            <p className={`mt-4 max-w-2xl text-white/90 ${isCentered ? "mx-auto" : ""}`}>{props.subcopy}</p>
          ) : null}
          <div className={`mt-8 ${isCentered ? "flex justify-center" : ""}`}>
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
        <SplitHeroLayout
          mediaRight={false}
          copy={
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
          }
          media={
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
          }
        />
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

export function TextMarquee(props: {
  id?: string;
  label?: string;
  phrases: string[];
  speed?: "slow" | "normal" | "fast";
}) {
  const duration = props.speed === "fast" ? "20s" : props.speed === "slow" ? "45s" : "30s";
  const items = [...props.phrases, ...props.phrases];

  return (
    <SectionShell
      id={props.id}
      templateId="text_marquee"
      mode="band"
      className="overflow-hidden border-y border-border bg-bg py-10"
    >
      <Container>
        {props.label ? <SectionLabel>{props.label}</SectionLabel> : null}
        <div
          className="flex animate-marquee gap-16 whitespace-nowrap"
          style={{ "--marquee-duration": duration } as React.CSSProperties}
        >
          {items.map((phrase, i) => (
            <span key={i} className="font-display text-2xl text-text/80 md:text-3xl">
              {phrase}
              <span className="mx-8 text-accent" aria-hidden>
                ·
              </span>
            </span>
          ))}
        </div>
      </Container>
    </SectionShell>
  );
}

export function FooterCta(props: {
  id?: string;
  headline: string;
  subcopy?: string;
  cta: CtaField;
  secondaryCta?: CtaField;
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
}) {
  const variant = props.layoutVariant ?? "band-wide";
  const pad =
    props.density === "compact"
      ? "py-12"
      : props.density === "airy" || variant === "band-wide"
        ? "py-24 md:py-28"
        : "py-16 md:py-20";
  const stack = variant === "centered-stack";

  if (stack) {
    return (
      <SectionShell
        id={props.id}
        templateId="footer_cta"
        mode="band"
        layoutVariant={variant}
        className={`border-t border-border bg-surface ${pad}`}
      >
        <Container narrow="md" className="text-center">
          <Reveal>
            <DisplayHeading>{props.headline}</DisplayHeading>
            {props.subcopy ? <p className="mt-3 max-w-xl mx-auto text-muted">{props.subcopy}</p> : null}
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <a
                href={props.cta.href ?? "#contact"}
                className="inline-flex rounded-full bg-accent px-8 py-3 font-semibold text-white"
              >
                {props.cta.label}
              </a>
              {props.secondaryCta ? (
                <a
                  href={props.secondaryCta.href ?? "/contact"}
                  className="inline-flex rounded-full border border-border px-8 py-3 font-semibold text-text"
                >
                  {props.secondaryCta.label}
                </a>
              ) : null}
            </div>
          </Reveal>
        </Container>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      id={props.id}
      templateId="footer_cta"
      mode="band"
      layoutVariant={variant}
      className={`border-t border-border bg-surface ${pad}`}
    >
      <Container>
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <DisplayHeading>{props.headline}</DisplayHeading>
              {props.subcopy ? <p className="mt-3 text-muted">{props.subcopy}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-4">
              <a
                href={props.cta.href ?? "#contact"}
                className="inline-flex rounded-full bg-accent px-8 py-3 font-semibold text-white"
              >
                {props.cta.label}
              </a>
              {props.secondaryCta ? (
                <a
                  href={props.secondaryCta.href ?? "/contact"}
                  className="inline-flex rounded-full border border-border px-8 py-3 font-semibold text-text"
                >
                  {props.secondaryCta.label}
                </a>
              ) : null}
            </div>
          </div>
        </Reveal>
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
        <Stagger className="card-grid sm:grid-cols-2 lg:grid-cols-3">
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
                <Media src={img.src!} alt={img.alt ?? img.caption ?? "Gallery image"} className="w-full rounded-sm object-cover" />
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

export {
  HeroVideo,
  TestimonialCarousel,
  PortfolioCarousel,
  BeforeAfter,
  PricingToggle,
  StatsAnimated,
  NewsletterBand,
} from "./immersive";

export { HeroSpotlight, ScrollShowcase, HorizontalGallery } from "./premium";
