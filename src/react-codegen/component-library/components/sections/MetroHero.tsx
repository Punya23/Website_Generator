"use client";

import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { SectionIdProvider } from "../SectionContext";

type ImageField = { src?: string; alt?: string };
type CtaField = { label: string; href?: string };
type MetroImage = { caption?: string; image?: ImageField };

export type HeroMetroProps = {
  id?: string;
  label?: string;
  headline: string;
  subcopy?: string;
  scrollHint?: string;
  comingUpLabel?: string;
  images?: MetroImage[];
  /** @deprecated kept only for props saved before the image-reveal rewrite */
  video?: { src?: string; poster?: ImageField };
  /** @deprecated no-op, accepted for backward compatibility with older generated props */
  lockPage?: boolean;
  cta?: CtaField;
  scrubDistance?: number;
  layoutVariant?: string;
  density?: "airy" | "normal" | "compact";
  className?: string;
  style?: CSSProperties;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Coded backdrop panels behind each still — always visible under real photos, and on their own when a frame has no photo. Static; only the wrapping layer's clip-path/scale/opacity are mutated per scroll frame. */
const GRAPHICS = [
  "radial-gradient(90% 70% at 20% 20%, color-mix(in srgb, var(--color-accent) 45%, transparent), transparent 60%), linear-gradient(160deg, #14161d, #07080c)",
  "repeating-linear-gradient(-26deg, color-mix(in srgb, var(--color-accent) 22%, transparent) 0 16px, transparent 16px 32px), radial-gradient(80% 60% at 84% 16%, color-mix(in srgb, var(--color-accent) 32%, transparent), #07080c 70%)",
  "radial-gradient(circle at 50% 115%, color-mix(in srgb, var(--color-accent) 38%, transparent), transparent 45%), linear-gradient(180deg, #0d0f15, #07080c)",
  "conic-gradient(from 210deg at 72% 38%, color-mix(in srgb, var(--color-accent) 30%, transparent), transparent 42%, #0b0d12 72%), linear-gradient(135deg, #121520, #07080c)",
  "radial-gradient(70% 90% at 82% 82%, color-mix(in srgb, var(--color-accent) 34%, transparent), transparent 55%), linear-gradient(200deg, #101319, #07080c)",
];

function StaticMetroHero({
  headline,
  label,
  subcopy,
  cta,
  frame,
}: {
  headline: string;
  label?: string;
  subcopy?: string;
  cta?: CtaField;
  frame: MetroImage;
}) {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "80vh",
        width: "100%",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: "#f4f4f5",
        background: GRAPHICS[0],
      }}
    >
      {frame.image?.src ? (
        <img
          src={frame.image.src}
          alt={frame.image.alt ?? headline}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(7,8,12,0.4), rgba(7,8,12,0.6))",
        }}
      />
      <div style={{ position: "relative", zIndex: 1, padding: "0 8%", maxWidth: 720 }}>
        {label ? (
          <p style={{ margin: "0 0 0.85rem", fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", opacity: 0.75 }}>
            {label}
          </p>
        ) : null}
        <h1 style={{ margin: 0, fontFamily: "var(--font-display, inherit)", fontWeight: 600, fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.08, letterSpacing: "-0.03em" }}>
          {headline}
        </h1>
        {subcopy ? (
          <p style={{ margin: "1rem 0 0", fontSize: "clamp(1rem, 1.6vw, 1.25rem)", opacity: 0.85 }}>{subcopy}</p>
        ) : null}
        {cta ? (
          <a
            href={cta.href ?? "#contact"}
            className="mt-8 inline-flex items-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white no-underline"
            style={{ marginTop: "1.5rem" }}
          >
            {cta.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function HeroMetro({
  id,
  label,
  headline,
  subcopy,
  scrollHint = "SCROLL TO REVEAL",
  comingUpLabel = "Coming up",
  images,
  video,
  cta,
  scrubDistance,
  layoutVariant,
  className,
  style,
}: HeroMetroProps) {
  const frames = useMemo<MetroImage[]>(() => {
    const next = (images?.length ? images : [{ image: video?.poster, caption: headline }]).slice(0, 5);
    while (next.length < 3) next.push({ caption: headline, image: video?.poster });
    return next;
  }, [images, video?.poster, headline]);

  const effectiveScrub = clamp(scrubDistance ?? frames.length * 560, 1600, 3600);
  const holdFrac = 0.3;

  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const titleRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const comingRef = useRef<HTMLDivElement>(null);
  const comingCaptionRef = useRef<HTMLSpanElement>(null);
  const indexRef = useRef<HTMLSpanElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Direct imperative DOM writes on every scroll update — driven by useScroll's
  // already-optimized subscription (passive listener, internally batched to rAF).
  // Deliberately NOT bound through motion.div's `style` MotionValue passthrough:
  // that path can hand these updates off to a native scroll-timeline animation,
  // which doesn't track custom multi-breakpoint ranges reliably. Writing style
  // directly here keeps every value exact and guarantees this stops costing
  // anything the moment scrolling stops (no perpetual per-frame loop).
  const applyProgress = (raw: number) => {
    const progress = clamp(raw, 0, 1);
    const count = frames.length;
    const last = Math.max(1, count - 1);
    const segLen = 1 / last;

    frames.forEach((_, i) => {
      const layer = layerRefs.current[i];
      if (!layer) return;
      if (i === 0) {
        layer.style.clipPath = "none";
        layer.style.transform = `scale(${1 + progress * 0.03})`;
        return;
      }
      const wipeStart = (i - 1) * segLen + holdFrac * segLen;
      const wipeEnd = i * segLen;
      const t = clamp((progress - wipeStart) / Math.max(0.0001, wipeEnd - wipeStart), 0, 1);
      const eased = t * t * (3 - 2 * t);
      layer.style.clipPath = `inset(${(1 - eased) * 100}% 0 0 0)`;
      layer.style.transform = `scale(${1.06 - eased * 0.06})`;
    });

    if (titleRef.current) {
      const t = 1 - clamp(progress / 0.16, 0, 1);
      titleRef.current.style.opacity = String(t);
      titleRef.current.style.transform = `translateY(${(1 - t) * -26}px)`;
    }
    if (hintRef.current) {
      hintRef.current.style.opacity = String(1 - clamp(progress / 0.05, 0, 1));
    }
    if (taglineRef.current) {
      const t = clamp((progress - 0.8) / 0.14, 0, 1);
      taglineRef.current.style.opacity = String(t);
      taglineRef.current.style.transform = `translateY(${(1 - t) * 18}px)`;
    }
    if (ctaRef.current) {
      const t = clamp((progress - 0.88) / 0.1, 0, 1);
      ctaRef.current.style.opacity = String(t);
    }
    if (progressFillRef.current) {
      progressFillRef.current.style.transform = `scaleX(${progress})`;
    }

    const rawIndex = progress * last;
    const active = Math.min(count - 1, Math.floor(rawIndex + 0.0001));
    const localT = segLen > 0 ? rawIndex - active : 1;
    const next = Math.min(count - 1, active + 1);
    const showComing = next !== active && localT < holdFrac && progress > 0.01 && progress < 0.97;

    if (indexRef.current) indexRef.current.textContent = `${pad(active + 1)} / ${pad(count)}`;
    if (comingRef.current) {
      comingRef.current.style.opacity = showComing ? "1" : "0";
      comingRef.current.style.transform = `translateY(${showComing ? 0 : 10}px)`;
    }
    if (comingCaptionRef.current && next !== active) {
      comingCaptionRef.current.textContent = frames[next]?.caption?.trim() || frames[next]?.image?.alt || headline;
    }
  };

  useMotionValueEvent(scrollYProgress, "change", applyProgress);

  useEffect(() => {
    if (reduceMotion) return;
    applyProgress(scrollYProgress.get());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, frames]);

  if (reduceMotion) {
    return (
      <SectionIdProvider id={id}>
        <section id={id} data-section={id} data-template="hero_metro" data-layout-variant={layoutVariant} className={className} style={style}>
          <StaticMetroHero headline={headline} label={label} subcopy={subcopy} cta={cta} frame={frames[frames.length - 1]!} />
        </section>
      </SectionIdProvider>
    );
  }

  return (
    <SectionIdProvider id={id}>
      <section
        ref={sectionRef}
        data-section={id}
        data-template="hero_metro"
        data-layout-variant={layoutVariant}
        className={className}
        style={{ position: "relative", width: "100%", height: `calc(100dvh + ${effectiveScrub}px)`, ...style }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100dvh",
            overflow: "hidden",
            background: "#07080c",
            color: "#f4f4f5",
            fontFamily: "var(--font-body, inherit)",
          }}
        >
          {frames.map((item, i) => (
            <div
              key={`${item.caption ?? "frame"}-${i}`}
              ref={(el) => {
                layerRefs.current[i] = el;
              }}
              style={{
                position: "absolute",
                inset: 0,
                clipPath: i === 0 ? "none" : "inset(100% 0 0 0)",
                transformOrigin: "center center",
                willChange: "clip-path, transform",
              }}
            >
              <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: GRAPHICS[i % GRAPHICS.length] }} />
              {item.image?.src ? (
                <img
                  src={item.image.src}
                  alt={item.image.alt ?? item.caption ?? headline}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(7,8,12,0.4) 0%, rgba(7,8,12,0.08) 42%, rgba(7,8,12,0.58) 100%)",
                }}
              />
            </div>
          ))}

          <div
            ref={titleRef}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 8%",
              textAlign: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div>
              {label ? (
                <p style={{ margin: "0 0 0.85rem", fontSize: 11, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(244,244,245,0.7)" }}>
                  {label}
                </p>
              ) : null}
              <h1 style={{ margin: 0, fontFamily: "var(--font-display, inherit)", fontWeight: 600, fontSize: "clamp(2rem, 6vw, 5.5rem)", lineHeight: 1.05, letterSpacing: "-0.03em" }}>
                {headline}
              </h1>
            </div>
          </div>

          {(subcopy || label) && (
            <div
              ref={taglineRef}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 10%",
                textAlign: "center",
                pointerEvents: "none",
                zIndex: 2,
                opacity: 0,
              }}
            >
              <p style={{ margin: 0, maxWidth: "22ch", fontFamily: "var(--font-display, inherit)", fontSize: "clamp(1.4rem, 3vw, 2.4rem)", lineHeight: 1.25, letterSpacing: "-0.02em" }}>
                {subcopy ?? label}
              </p>
            </div>
          )}

          {cta ? (
            <div ref={ctaRef} style={{ position: "absolute", left: "50%", bottom: "22vh", transform: "translateX(-50%)", zIndex: 3, opacity: 0 }}>
              <motion.a
                href={cta.href ?? "#contact"}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white no-underline"
              >
                {cta.label}
              </motion.a>
            </div>
          ) : null}

          <div
            ref={comingRef}
            style={{
              position: "absolute",
              left: "clamp(1.25rem, 4vw, 2.5rem)",
              bottom: "clamp(2.4rem, 7vh, 3.6rem)",
              zIndex: 3,
              opacity: 0,
              transition: "opacity 0.25s ease, transform 0.25s ease",
              pointerEvents: "none",
            }}
          >
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-accent) 80%, white)" }}>
              {comingUpLabel}
            </p>
            <span ref={comingCaptionRef} style={{ display: "block", marginTop: 6, fontFamily: "var(--font-display, inherit)", fontSize: "clamp(1.05rem, 2.2vw, 1.6rem)", letterSpacing: "-0.02em" }} />
          </div>

          <div
            style={{
              position: "absolute",
              right: "clamp(1.25rem, 4vw, 2.5rem)",
              bottom: "clamp(2.4rem, 7vh, 3.6rem)",
              zIndex: 3,
              textAlign: "right",
              pointerEvents: "none",
            }}
          >
            <span ref={indexRef} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", color: "rgba(244,244,245,0.7)" }}>
              {pad(1)} / {pad(frames.length)}
            </span>
          </div>

          <div
            ref={hintRef}
            style={{
              position: "absolute",
              left: "50%",
              bottom: "clamp(1.4rem, 5vh, 2.4rem)",
              transform: "translateX(-50%)",
              zIndex: 3,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.28em",
              color: "rgba(244,244,245,0.65)",
              pointerEvents: "none",
            }}
          >
            {scrollHint}
          </div>

          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: "rgba(255,255,255,0.1)", zIndex: 4 }}>
            <div ref={progressFillRef} style={{ height: "100%", width: "100%", background: "var(--color-accent)", transform: "scaleX(0)", transformOrigin: "left center" }} />
          </div>
        </div>
      </section>
    </SectionIdProvider>
  );
}

export default HeroMetro;
