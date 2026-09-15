#!/usr/bin/env bash
# Starts the playground with the curated real-estate placements pipeline turned on
# (PIPELINE_PLACEMENTS=1 — src/orchestrator/orchestrator.ts's `placements` branch,
# src/orchestrator/placements-pipeline.ts). Off by default; see docs/PLACEMENTS_ORCHESTRATION_PLAN.md.
#
# Which of the 4 real-estate/* templates you land on is picked automatically per generation by
# pickRealEstateTemplate() (src/orchestrator/placements-pipeline.ts), scored against your brief's
# own wording — real-estate-agency is the generalist fallback when nothing else scores higher.
# Paste one of the sample briefs below into the playground to hit a specific one on purpose.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${OPENROUTER_API_KEY:-}" ] && ! grep -q "^OPENROUTER_API_KEY=" .env 2>/dev/null; then
  echo "WARNING: no OPENROUTER_API_KEY in env or .env — the placements fill will throw" \
       "'No LLM configured' the moment you submit a brief." >&2
fi

cat <<'EOF'
Sample briefs — one per template (pickRealEstateTemplate scores keyword hits; ties/zero go to
real-estate-agency):

  [real-estate-agency]  (no sub-vertical keywords — the generalist default)
    Golden Gate Realty is a family-run residential agency in San Francisco helping first-time
    buyers and downsizers. Phone (415) 555-0133, hello@goldengaterealty.com.

  [luxury-real-estate]  (luxury / high-end / estate / waterfront / penthouse / prestige / bespoke / elite / exclusive / premier)
    Aurelia Estates handles luxury waterfront properties and exclusive penthouse listings for
    high-end buyers across the Bay Area. Bespoke, white-glove service for a premier clientele.

  [commercial-real-estate]  (commercial / office space / retail space / industrial / warehouse / tenant / investor / lease rate / square footage / coworking)
    We broker commercial office space and retail space leases for investors — tenant
    negotiations, lease rate analysis, and square footage buildouts across the East Bay.

  [property-management]  (property management / landlord / rental / rent collection / maintenance request / hoa / leasing office / portfolio of properties)
    Harborview provides property management for landlords with a growing portfolio of
    properties — rent collection, maintenance requests, and HOA coordination.

Playground starting — PIPELINE_PLACEMENTS=1. Paste a brief above into the UI to generate.
EOF

PIPELINE_PLACEMENTS=1 npm run playground
