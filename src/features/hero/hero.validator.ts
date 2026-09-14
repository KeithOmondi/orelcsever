// src/features/hero/hero.validator.ts
//
// Zod v4 schemas for the Hero feature.
//
// These validate *incoming HTTP request bodies*, not outgoing responses.
// Response shaping is the service's job.
//
// `heroVersionPayloadSchema` is the single source of truth for the shape
// of a Hero snapshot. The approve/reject schemas are intentionally thin —
// they only need an id and an optional note.
//
// `heroVersionIdParamSchema` is wrapped as `{ params: { versionId } }`
// so it works with `validate.middleware.ts` — that middleware only reads
// from req.params when the schema has a `.shape.params` branch. A flat
// `{ versionId }` schema would be treated as a body/query schema and
// validated against the wrong input.
//
// Slide images are uploaded, not linked. `imageUrl` comes from the upload
// endpoint's response; `imagePublicId` travels with it so the service can
// clean up Cloudinary when a slide is replaced or removed.

import { z } from 'zod';

// ─── Reusable primitives ─────────────────────────────────────────────────────

const trimmedString = (field: string, max = 500) =>
  z
    .string({ error: `${field} is required.` })
    .trim()
    .min(1, { error: `${field} is required.` })
    .max(max, { error: `${field} must be ${max} characters or fewer.` });

const optionalTrimmedString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, { error: `Must be ${max} characters or fewer.` })
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v ?? null));

// ─── Slides ──────────────────────────────────────────────────────────────────
//
// `imageUrl` is a plain string, not z.url(). Cloudinary returns full URLs,
// but keeping it a string means a locally-mocked uploader or a same-origin
// proxy path still validates. Length is the only hard constraint.

export const heroSlideSchema = z.object({
  imageUrl: trimmedString('Slide image URL', 500),
  imagePublicId: optionalTrimmedString(200),
  altText:  optionalTrimmedString(200),
  ctaLabel: optionalTrimmedString(80),
  ctaHref:  optionalTrimmedString(500),
  displayOrder: z
    .number({ error: 'Slide display order is required.' })
    .int({ error: 'Slide display order must be an integer.' })
    .min(0, { error: 'Slide display order cannot be negative.' }),
  isActive: z.boolean().default(true),
});

export const heroSlidesSchema = z
  .array(heroSlideSchema)
  .min(1, { error: 'At least one slide is required.' })
  .max(10, { error: 'A maximum of 10 slides is allowed.' })
  .refine(
    (slides) => {
      const orders = slides.map((s) => s.displayOrder);
      return new Set(orders).size === orders.length;
    },
    { error: 'Slide display orders must be unique.' }
  );

// ─── Badges ──────────────────────────────────────────────────────────────────

export const heroBadgeSchema = z.object({
  label:        trimmedString('Badge label', 50),
  value:        trimmedString('Badge value', 80),
  icon:         trimmedString('Badge icon', 50),
  displayOrder: z
    .number({ error: 'Badge display order is required.' })
    .int({ error: 'Badge display order must be an integer.' })
    .min(0, { error: 'Badge display order cannot be negative.' }),
  isActive: z.boolean().default(true),
});

export const heroBadgesSchema = z
  .array(heroBadgeSchema)
  .max(6, { error: 'A maximum of 6 badges is allowed.' })
  .refine(
    (badges) => {
      const orders = badges.map((b) => b.displayOrder);
      return new Set(orders).size === orders.length;
    },
    { error: 'Badge display orders must be unique.' }
  );

// ─── Search card ─────────────────────────────────────────────────────────────

export const heroSearchTabSchema = z.object({
  key:         trimmedString('Tab key', 30),
  label:       trimmedString('Tab label', 40),
  placeholder: trimmedString('Tab placeholder', 120),
  ctaLabel:    trimmedString('Tab CTA label', 40),
});

export const heroSearchCardSchema = z.object({
  title:            trimmedString('Search card title', 80),
  subtitle:         trimmedString('Search card subtitle', 250),
  selfServiceBadge: trimmedString('Self-service badge', 40),
  tabs: z
    .array(heroSearchTabSchema)
    .min(1, { error: 'At least one search tab is required.' })
    .max(5, { error: 'A maximum of 5 search tabs is allowed.' })
    .refine(
      (tabs) => {
        const keys = tabs.map((t) => t.key);
        return new Set(keys).size === keys.length;
      },
      { error: 'Tab keys must be unique.' }
    ),
  documentsLabel:     trimmedString('Documents label', 80),
  documentsLinkLabel: trimmedString('Documents link label', 80),
  documentsHref:      trimmedString('Documents link href', 500),
});

// ─── Full payload — the single source of truth for a Hero snapshot ──────────

export const heroVersionPayloadSchema = z.object({
  badge:       trimmedString('Badge', 120),
  headline:    trimmedString('Headline', 200),
  subheadline: trimmedString('Subheadline', 500),
  slides:      heroSlidesSchema,
  badges:      heroBadgesSchema,
  searchCard:  heroSearchCardSchema,
});

// ─── Action inputs ──────────────────────────────────────────────────────────

// POST /hero/draft  — create a new draft, or update an existing one
export const saveHeroDraftSchema = z.object({
  versionId: z.uuid({ error: 'versionId must be a valid UUID.' }).optional(),
  payload:   heroVersionPayloadSchema,
});

// POST /hero/versions/:versionId/approve
export const approveHeroVersionSchema = z.object({
  reviewNote: optionalTrimmedString(500),
});

// POST /hero/versions/:versionId/reject
export const rejectHeroVersionSchema = z.object({
  reviewNote: trimmedString('Rejection reason', 500),
});

// ─── Route params ───────────────────────────────────────────────────────────
//
// Wrapped as `{ params: { ... } }` so `validate.middleware.ts` knows to
// read from `req.params` instead of `req.body` / `req.query`.

export const heroVersionIdParamSchema = z.object({
  params: z.object({
    versionId: z.uuid({ error: 'versionId must be a valid UUID.' }),
  }),
});

// ─── Inferred types ─────────────────────────────────────────────────────────
//
// These are the *input* types (post-parse). They should be assignable to
// the corresponding entries in `hero.types.ts`. If the compiler complains
// here, the validator and the domain types have drifted.

export type HeroVersionPayloadInput    = z.infer<typeof heroVersionPayloadSchema>;
export type SaveHeroDraftInputSchema   = z.infer<typeof saveHeroDraftSchema>;
export type ApproveHeroVersionInputSchema = z.infer<typeof approveHeroVersionSchema>;
export type RejectHeroVersionInputSchema  = z.infer<typeof rejectHeroVersionSchema>;
export type HeroVersionIdParam         = z.infer<typeof heroVersionIdParamSchema>;