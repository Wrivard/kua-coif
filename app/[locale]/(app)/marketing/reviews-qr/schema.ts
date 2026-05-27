import { z } from 'zod';

/**
 * Schema for the public review URL. Owner can set it to anything they
 * want clients to land on — Google Business Profile, Yelp page,
 * Instagram, our own /review/[token] flow, etc. Empty string clears
 * the column.
 */
export const reviewUrlSchema = z.object({
  public_review_url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https:\/\/.+/i.test(v), 'INVALID_URL'),
});

export type ReviewUrlInput = z.infer<typeof reviewUrlSchema>;
