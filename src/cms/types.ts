import { z } from "zod";

export const CmsFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["text", "richtext", "image", "slug", "date"]),
});

export const CmsItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
  body: z.string().optional(),
  imageQuery: z.string().optional(),
  imageUrl: z.string().optional(),
  publishedAt: z.string().optional(),
  fields: z.record(z.string()).optional(),
});

export const CmsCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  singularName: z.string(),
  fields: z.array(CmsFieldSchema),
  items: z.array(CmsItemSchema),
});

export type CmsField = z.infer<typeof CmsFieldSchema>;
export type CmsItem = z.infer<typeof CmsItemSchema>;
export type CmsCollection = z.infer<typeof CmsCollectionSchema>;
