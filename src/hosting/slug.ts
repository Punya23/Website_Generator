/** URL-safe tenant slug from business name. */
export function siteSlugFromName(businessName: string): string {
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "site";
}

export function storagePrefixForSlug(slug: string): string {
  return `sites/${slug}`;
}
