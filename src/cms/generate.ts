import type { ExpandedBrief } from "../types.js";
import type { CmsCollection, CmsItem } from "./types.js";
import { CmsCollectionSchema } from "./types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function blogPosts(brief: ExpandedBrief): CmsItem[] {
  const topics = [
    { title: `Why ${brief.businessName} stands out`, excerpt: brief.elevatorPitch },
    {
      title: `A guide to ${brief.services[0] ?? "our core service"}`,
      excerpt: `Everything you need to know about ${brief.services[0] ?? "what we offer"}.`,
    },
    {
      title: `Behind the scenes at ${brief.businessName}`,
      excerpt: brief.differentiators[0] ?? brief.tagline,
    },
  ];

  return topics.map((t, i) => ({
    id: `post_${i}`,
    slug: slugify(t.title),
    title: t.title,
    excerpt: t.excerpt,
    body: `${t.excerpt}\n\n${brief.expandedBrief}`,
    imageQuery: `${brief.businessName} ${brief.services[i % brief.services.length]}`,
    publishedAt: new Date(Date.now() - i * 86_400_000 * 14).toISOString().slice(0, 10),
  }));
}

function portfolioItems(brief: ExpandedBrief): CmsItem[] {
  return brief.services.slice(0, 4).map((svc, i) => ({
    id: `work_${i}`,
    slug: slugify(svc),
    title: svc,
    excerpt: `${svc} — delivered with ${brief.tone}.`,
    body: `${brief.businessName} specializes in ${svc}. ${brief.elevatorPitch}`,
    imageQuery: `${brief.businessName} ${svc}`,
  }));
}

export function generateCmsCollections(brief: ExpandedBrief): CmsCollection[] {
  const blog = CmsCollectionSchema.parse({
    id: "blog",
    name: "Blog",
    slug: "blog",
    singularName: "Post",
    fields: [
      { id: "title", label: "Title", type: "text" },
      { id: "excerpt", label: "Excerpt", type: "text" },
      { id: "body", label: "Body", type: "richtext" },
      { id: "image", label: "Cover image", type: "image" },
      { id: "publishedAt", label: "Published", type: "date" },
    ],
    items: blogPosts(brief),
  });

  const portfolio = CmsCollectionSchema.parse({
    id: "portfolio",
    name: "Portfolio",
    slug: "portfolio",
    singularName: "Project",
    fields: [
      { id: "title", label: "Title", type: "text" },
      { id: "excerpt", label: "Summary", type: "text" },
      { id: "body", label: "Description", type: "richtext" },
      { id: "image", label: "Image", type: "image" },
    ],
    items: portfolioItems(brief),
  });

  return [blog, portfolio];
}
