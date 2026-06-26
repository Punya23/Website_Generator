import { validateTemplateProps } from "../section-templates/registry.js";
import { polishSectionProps } from "./polish-section-props.js";
import { sanitizePropsForCodegen } from "../react-codegen/sanitize-props.js";
import type { ExpandedBrief } from "../types.js";

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, val] of Object.entries(overlay)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      if (Array.isArray(out[key])) {
        out[key] = (out[key] as unknown[]).map((item, i) => {
          const overlayItem = val[i];
          if (
            item &&
            typeof item === "object" &&
            overlayItem &&
            typeof overlayItem === "object" &&
            !Array.isArray(item)
          ) {
            return { ...(item as Record<string, unknown>), ...(overlayItem as Record<string, unknown>) };
          }
          return overlayItem ?? item;
        });
      } else {
        out[key] = val;
      }
    } else if (val && typeof val === "object" && out[key] && typeof out[key] === "object" && !Array.isArray(val)) {
      out[key] = { ...(out[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function mergeSectionProps(
  templateId: string,
  copyProps: Record<string, unknown>,
  mediaProps: Record<string, unknown>,
  sectionIntent: string,
  brief: ExpandedBrief
): Record<string, unknown> {
  let props = deepMerge(copyProps, mediaProps);
  props = validateTemplateProps(templateId, props);
  props = polishSectionProps(templateId, props, sectionIntent, brief);
  return sanitizePropsForCodegen(props);
}
