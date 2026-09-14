// src/features/hero/hero.service.ts
//
// Service layer for the Hero feature.
//
// Responsibilities:
//   - Read the live Hero (assembled from 4 normalized tables).
//   - Manage drafts (hero_versions rows with status 'draft' | 'pending').
//   - Promote a version to live (status 'approved').
//   - Reject a version (status 'rejected').
//   - Roll the live Hero back to a prior approved version.
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import type { Role } from '../../types/roles';
import type {
  Hero,
  HeroBadge,
  HeroSearchCard,
  HeroSearchTab,
  HeroSlide,
  HeroVersion,
  HeroVersionPayload,
  HeroVersionStatus,
  HeroVersionSummary,
} from './hero.types';
import type {
  HeroVersionPayloadInput,
} from './hero.validator';

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names. Every
// domain type in hero.types.ts is camelCase. These functions are the only
// place the conversion happens.

const mapSlideRow = (row: Record<string, any>): HeroSlide => ({
  id:            row.id,
  imageUrl:      row.image_url,
  imagePublicId: row.image_public_id,
  altText:       row.alt_text,
  ctaLabel:      row.cta_label,
  ctaHref:       row.cta_href,
  displayOrder:  row.display_order,
  isActive:      row.is_active,
  createdAt:     row.created_at,
  updatedAt:     row.updated_at,
});

const mapBadgeRow = (row: Record<string, any>): HeroBadge => ({
  id:           row.id,
  label:        row.label,
  value:        row.value,
  icon:         row.icon,
  displayOrder: row.display_order,
  isActive:     row.is_active,
  createdAt:    row.created_at,
  updatedAt:    row.updated_at,
});

const mapSearchCardRow = (row: Record<string, any>): HeroSearchCard => ({
  id:                 row.id,
  title:              row.title,
  subtitle:           row.subtitle,
  selfServiceBadge:   row.self_service_badge,
  tabs:               row.tabs as HeroSearchTab[],
  documentsLabel:     row.documents_label,
  documentsLinkLabel: row.documents_link_label,
  documentsHref:      row.documents_href,
  updatedAt:          row.updated_at,
});

const mapVersionRow = (row: Record<string, any>): HeroVersion => ({
  id:            row.id,
  status:        row.status,
  payload:       row.payload as HeroVersionPayload,
  createdBy:     row.created_by,
  createdByRole: row.created_by_role,
  createdAt:     row.created_at,
  reviewedBy:    row.reviewed_by,
  reviewedAt:    row.reviewed_at,
  reviewNote:    row.review_note,
});

const mapVersionSummary = (v: HeroVersion): HeroVersionSummary => ({
  id:            v.id,
  status:        v.status,
  createdBy:     v.createdBy,
  createdByRole: v.createdByRole,
  createdAt:     v.createdAt,
  reviewedBy:    v.reviewedBy,
  reviewedAt:    v.reviewedAt,
  reviewNote:    v.reviewNote,
});

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Returns the singleton live Hero row, or throws if the DB hasn't been
 * seeded yet. `hero` is guaranteed to have exactly one row (enforced by a
 * CHECK constraint in the migration).
 */
const getLiveHeroRow = async (): Promise<Record<string, any>> => {
  const result = await query('SELECT * FROM hero LIMIT 1');
  if (!result.rowCount) {
    throw new AppError('Hero has not been initialised.', 500);
  }
  return result.rows[0];
};

/**
 * Promotes a version payload onto the live tables inside a transaction.
 * Wipes and rewrites slides / badges / search_card. The `hero` row itself
 * is UPDATEd in place (its id never changes).
 *
 * Called only from approveVersion and rollbackVersion.
 */
const promotePayload = async (
  heroId: string,
  payload: HeroVersionPayload,
  versionId: string,
): Promise<void> => {
  // `query` here is expected to support transactions via a client.
  // If your db.ts exposes only a `query(text, params)` helper, wrap the
  // three statements in a single query() using a BEGIN/COMMIT block, or
  // add a `withTransaction` helper. The service assumes the former.
  const client = await (query as any).connect?.();
  const run = client
    ? (text: string, params?: any[]) => client.query(text, params)
    : query;
  const finish = async () => {
    if (client) client.release();
  };

  try {
    if (client) await run('BEGIN');

    // 1. hero row
    await run(
      `UPDATE hero
         SET badge = $1,
             headline = $2,
             subheadline = $3,
             live_version_id = $4,
             updated_at = NOW()
       WHERE id = $5`,
      [payload.badge, payload.headline, payload.subheadline, versionId, heroId],
    );

    // 2. slides — wipe and re-insert
    await run('DELETE FROM hero_slides WHERE hero_id = $1', [heroId]);
    for (const slide of payload.slides) {
      await run(
        `INSERT INTO hero_slides
           (hero_id, image_url, image_public_id, alt_text, cta_label, cta_href, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          heroId,
          slide.imageUrl,
          slide.imagePublicId,
          slide.altText,
          slide.ctaLabel,
          slide.ctaHref,
          slide.displayOrder,
          slide.isActive,
        ],
      );
    }

    // 3. badges — wipe and re-insert
    await run('DELETE FROM hero_badges WHERE hero_id = $1', [heroId]);
    for (const badge of payload.badges) {
      await run(
        `INSERT INTO hero_badges
           (hero_id, label, value, icon, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          heroId,
          badge.label,
          badge.value,
          badge.icon,
          badge.displayOrder,
          badge.isActive,
        ],
      );
    }

    // 4. search card — one row per hero, so update-or-insert
    await run(
      `INSERT INTO hero_search_card
         (hero_id, title, subtitle, self_service_badge, tabs,
          documents_label, documents_link_label, documents_href)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (hero_id) DO UPDATE
         SET title = EXCLUDED.title,
             subtitle = EXCLUDED.subtitle,
             self_service_badge = EXCLUDED.self_service_badge,
             tabs = EXCLUDED.tabs,
             documents_label = EXCLUDED.documents_label,
             documents_link_label = EXCLUDED.documents_link_label,
             documents_href = EXCLUDED.documents_href,
             updated_at = NOW()`,
      [
        heroId,
        payload.searchCard.title,
        payload.searchCard.subtitle,
        payload.searchCard.selfServiceBadge,
        JSON.stringify(payload.searchCard.tabs),
        payload.searchCard.documentsLabel,
        payload.searchCard.documentsLinkLabel,
        payload.searchCard.documentsHref,
      ],
    );

    if (client) await run('COMMIT');
  } catch (err) {
    if (client) await run('ROLLBACK');
    throw err;
  } finally {
    await finish();
  }
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the live Hero. Used by the public site.
 */
export const getLiveHero = async (): Promise<Hero> => {
  const heroRow = await getLiveHeroRow();
  const heroId = heroRow.id;

  const [slidesRes, badgesRes, searchCardRes] = await Promise.all([
    query(
      `SELECT * FROM hero_slides
        WHERE hero_id = $1
        ORDER BY display_order ASC`,
      [heroId],
    ),
    query(
      `SELECT * FROM hero_badges
        WHERE hero_id = $1
        ORDER BY display_order ASC`,
      [heroId],
    ),
    query(`SELECT * FROM hero_search_card WHERE hero_id = $1 LIMIT 1`, [heroId]),
  ]);

  if (!searchCardRes.rowCount) {
    throw new AppError('Hero search card is missing.', 500);
  }

  return {
    id:            heroId,
    badge:         heroRow.badge,
    headline:      heroRow.headline,
    subheadline:   heroRow.subheadline,
    slides:        slidesRes.rows.map(mapSlideRow),
    badges:        badgesRes.rows.map(mapBadgeRow),
    searchCard:    mapSearchCardRow(searchCardRes.rows[0]),
    liveVersionId: heroRow.live_version_id,
    updatedAt:     heroRow.updated_at,
  };
};

/**
 * Read a single version by id. Used by the review UI and by rollback.
 */
export const getVersionById = async (versionId: string): Promise<HeroVersion> => {
  const result = await query('SELECT * FROM hero_versions WHERE id = $1', [
    versionId,
  ]);
  if (!result.rowCount) {
    throw new AppError('Hero version not found.', 404);
  }
  return mapVersionRow(result.rows[0]);
};

/**
 * List all versions, newest first. Used by the review history panel.
 */
export const listVersions = async (): Promise<HeroVersionSummary[]> => {
  const result = await query(
    'SELECT * FROM hero_versions ORDER BY created_at DESC',
  );
  return result.rows.map((row) => mapVersionSummary(mapVersionRow(row)));
};

/**
 * List only the versions that are awaiting review.
 */
export const listPendingVersions = async (): Promise<HeroVersionSummary[]> => {
  const result = await query(
    `SELECT * FROM hero_versions
      WHERE status = 'pending'
      ORDER BY created_at ASC`,
  );
  return result.rows.map((row) => mapVersionSummary(mapVersionRow(row)));
};

/**
 * The draft currently open for a given admin (there's at most one draft per
 * user). Returns null if they haven't started one.
 */
export const getMyDraft = async (
  userId: string,
): Promise<HeroVersion | null> => {
  const result = await query(
    `SELECT * FROM hero_versions
      WHERE created_by = $1 AND status = 'draft'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
  return result.rowCount ? mapVersionRow(result.rows[0]) : null;
};

/**
 * Create or update the caller's draft.
 *
 * If `versionId` is provided and belongs to the caller and is still a draft,
 * the payload is replaced. Otherwise a new draft row is created.
 */
export const saveDraft = async (
  userId: string,
  role: Role,
  payload: HeroVersionPayloadInput,
  versionId?: string,
): Promise<HeroVersion> => {
  if (versionId) {
    const existing = await getVersionById(versionId);
    if (existing.createdBy !== userId) {
      throw new AppError('You can only edit your own drafts.', 403);
    }
    if (existing.status !== 'draft') {
      throw new AppError('Only drafts can be edited.', 409);
    }

    const updated = await query(
      `UPDATE hero_versions
          SET payload = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [JSON.stringify(payload), versionId],
    );
    return mapVersionRow(updated.rows[0]);
  }

  // No draft id: create a fresh one.
  const inserted = await query(
    `INSERT INTO hero_versions
       (status, payload, created_by, created_by_role)
     VALUES ('draft', $1::jsonb, $2, $3)
     RETURNING *`,
    [JSON.stringify(payload), userId, role],
  );
  return mapVersionRow(inserted.rows[0]);
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitDraft = async (
  userId: string,
  versionId: string,
): Promise<HeroVersion> => {
  const existing = await getVersionById(versionId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own drafts.', 403);
  }
  if (existing.status !== 'draft') {
    throw new AppError('Only drafts can be submitted.', 409);
  }

  const updated = await query(
    `UPDATE hero_versions
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [versionId],
  );
  return mapVersionRow(updated.rows[0]);
};

/**
 * Approve a pending version. Promotes its payload onto the live tables.
 *
 * Anything previously `approved` is demoted to `superseded`.
 * Anything else `pending` is left alone (super_admin can approve them later).
 */
export const approveVersion = async (
  reviewerId: string,
  reviewerRole: Role,
  versionId: string,
  reviewNote?: string | null,
): Promise<HeroVersion> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve versions.', 403);
  }

  const version = await getVersionById(versionId);
  if (version.status !== 'pending') {
    throw new AppError('Only pending versions can be approved.', 409);
  }

  const heroRow = await getLiveHeroRow();

  // Demote the previously approved version, if any.
  await query(
    `UPDATE hero_versions
        SET status = 'superseded',
            updated_at = NOW()
      WHERE status = 'approved'`,
  );

  // Promote the payload onto the live tables.
  await promotePayload(heroRow.id, version.payload, version.id);

  // Mark this version approved.
  const updated = await query(
    `UPDATE hero_versions
        SET status = 'approved',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote ?? null, versionId],
  );

  return mapVersionRow(updated.rows[0]);
};

/**
 * Reject a pending version. Live tables are untouched.
 */
export const rejectVersion = async (
  reviewerId: string,
  reviewerRole: Role,
  versionId: string,
  reviewNote: string,
): Promise<HeroVersion> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject versions.', 403);
  }

  const version = await getVersionById(versionId);
  if (version.status !== 'pending') {
    throw new AppError('Only pending versions can be rejected.', 409);
  }

  const updated = await query(
    `UPDATE hero_versions
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, versionId],
  );
  return mapVersionRow(updated.rows[0]);
};

/**
 * Roll the live Hero back to a previously approved version. Creates a
 * *new* version row whose payload equals the target, so the audit trail
 * stays linear — you never mutate an old version's status back to approved.
 */
export const rollbackToVersion = async (
  reviewerId: string,
  reviewerRole: Role,
  versionId: string,
): Promise<HeroVersion> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can roll back versions.', 403);
  }

  const target = await getVersionById(versionId);
  if (target.status !== 'approved' && target.status !== 'superseded') {
    throw new AppError(
      'Only previously approved versions can be rolled back to.',
      409,
    );
  }

  const heroRow = await getLiveHeroRow();

  // Demote the currently approved version.
  await query(
    `UPDATE hero_versions
        SET status = 'superseded',
            updated_at = NOW()
      WHERE status = 'approved'`,
  );

  // Insert a new approved version that carries the target payload.
  const inserted = await query(
    `INSERT INTO hero_versions
       (status, payload, created_by, created_by_role,
        reviewed_by, reviewed_at, review_note)
     VALUES ('approved', $1::jsonb, $2, 'super_admin',
             $2, NOW(), $3)
     RETURNING *`,
    [
      JSON.stringify(target.payload),
      reviewerId,
      `Rolled back to version ${target.id}`,
    ],
  );

  // Promote it.
  await promotePayload(heroRow.id, target.payload, inserted.rows[0].id);

  return mapVersionRow(inserted.rows[0]);
};

/**
 * Delete a draft. Only the owner can delete it, and only while it's
 * still a draft. Pending / approved / rejected versions are immutable.
 */
export const deleteDraft = async (
  userId: string,
  versionId: string,
): Promise<void> => {
  const version = await getVersionById(versionId);

  if (version.createdBy !== userId) {
    throw new AppError('You can only delete your own drafts.', 403);
  }
  if (version.status !== 'draft') {
    throw new AppError('Only drafts can be deleted.', 409);
  }

  await query('DELETE FROM hero_versions WHERE id = $1', [versionId]);
};