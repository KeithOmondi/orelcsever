// src/features/judges/judges.service.ts
//
// Service layer for the Judges feature.
//
// Responsibilities:
//   - Public reads: list published judges, read one published judge.
//   - Admin reads: list all judges (any status), read any by id.
//   - Admin writes: create draft, update draft, submit for review,
//     delete a draft.
//   - Super admin writes: approve (→ published), reject (→ rejected).
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.
//
// Image lifecycle:
//   - Portraits are uploaded to Cloudinary by the *controller* (multer
//     → utils/upload.ts → uploadBuffer). The service receives the
//     resulting `ImageAsset | null` and never touches bytes.
//   - On create: the asset is written to the row.
//   - On update: the controller uploads the new asset first, then calls
//     this service. This service writes the row and, on success, deletes
//     the *old* asset. Order matters: upload → DB write → delete old.
//     Deleting the old asset before the DB write would lose the old
//     portrait if the write fails.
//   - On delete: the row is removed first, then the asset is deleted
//     fire-and-forget. A Cloudinary failure here must not roll back the
//     DB delete — the row is gone either way, and a stray asset is a
//     cleanup issue, not a correctness issue.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { deleteAsset } from '../../utils/upload';
import type { Role } from '../../types/roles';
import type {
  Judge,
  JudgeSummary,
  PublicJudge,
  PublicJudgeSummary,
  EducationEntry,
  ImageAsset,
} from './judges.types';
import type {
  JudgeInputPayload,
  UpdateJudgeInputSchema,
  ListJudgesQuery,
} from './judges.validator';

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names.
// Every domain type in judges.types.ts is camelCase. These functions
// are the only place the conversion happens.
//
// `education` and `specializations` are JSONB columns. pg returns them
// already parsed as arrays, so no decoding is needed — but we assert
// the shape so a malformed row fails loudly rather than rendering an
// empty modal.
//
// `image_url` + `image_public_id` are two columns that together form
// one domain field (`image`). Both must be present to count as an
// image; a row with only one of them is a data bug, so we treat it as
// "no image" and log loudly rather than half-render.

const assertEducationShape = (value: unknown): EducationEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is EducationEntry =>
      e &&
      typeof e === 'object' &&
      typeof (e as any).degree === 'string' &&
      typeof (e as any).institution === 'string' &&
      ((e as any).year === undefined || typeof (e as any).year === 'string'),
  );
};

const assertStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === 'string');
};

/**
 * Rebuild the `ImageAsset | null` from the two columns that store it.
 * A partial row (URL without publicId, or vice versa) is a bug: log
 * and treat as no image so the UI still renders.
 */
const mapImage = (
  url: string | null | undefined,
  publicId: string | null | undefined,
): ImageAsset | null => {
  if (url && publicId) {
    return { url, publicId };
  }
  if (url || publicId) {
    console.warn(
      '[judges.service] Row has a partial image: ' +
        `url=${url ?? 'null'} publicId=${publicId ?? 'null'}. ` +
        'Treating as no image.',
    );
  }
  return null;
};

const mapJudgeRow = (row: Record<string, any>): Judge => ({
  id:              row.id,
  name:            row.name,
  title:           row.title,
  station:         row.station,
  region:          row.region,
  appointedYear:   row.appointed_year,
  bio:             row.bio,
  education:       assertEducationShape(row.education),
  specializations: assertStringArray(row.specializations),
  image:           mapImage(row.image_url, row.image_public_id),
  status:          row.status,
  publishedAt:     row.published_at,
  createdBy:       row.created_by,
  createdByRole:   row.created_by_role,
  reviewedBy:      row.reviewed_by,
  reviewedAt:      row.reviewed_at,
  reviewNote:      row.review_note,
  createdAt:       row.created_at,
  updatedAt:       row.updated_at,
});

const mapJudgeSummary = (row: Record<string, any>): JudgeSummary => ({
  id:              row.id,
  name:            row.name,
  title:           row.title,
  station:         row.station,
  region:          row.region,
  appointedYear:   row.appointed_year,
  bio:             row.bio,
  education:       assertEducationShape(row.education),
  specializations: assertStringArray(row.specializations),
  image:           mapImage(row.image_url, row.image_public_id),
  status:          row.status,
  publishedAt:     row.published_at,
  createdAt:       row.created_at,
  updatedAt:       row.updated_at,
});

/**
 * Strips the internal audit fields before a row is sent to the public.
 * Keeping this here — next to the mapper — means the public endpoints
 * can't accidentally leak `reviewNote` by forgetting to filter.
 */
const toPublic = (judge: Judge): PublicJudge => {
  const {
    reviewNote,
    reviewedBy,
    reviewedAt,
    createdBy,
    createdByRole,
    ...rest
  } = judge;
  return rest;
};

const toPublicSummary = (summary: JudgeSummary): PublicJudgeSummary => {
  const { status, ...rest } = summary;
  return rest;
};

/**
 * Column list used by every read that returns a Summary. Kept as a
 * constant so the SELECT list and the mapper can't drift — if you add
 * a column to `mapJudgeSummary`, add it here too.
 */
const SUMMARY_COLUMNS = `
  id, name, title, station, region, appointed_year, bio,
  education, specializations, image_url, image_public_id,
  status, published_at, created_at, updated_at
`;

// ─── Transaction helper ──────────────────────────────────────────────────────
//
// Same shape as the other feature services. Judges have no
// multi-statement writes today — no featured toggle, no
// at-most-one-Principal-Judge enforcement — so this is currently
// unused. It's kept here for consistency and so a future rule can use
// it without re-plumbing.

const withTransaction = async <T>(
  fn: (run: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> => {
  const client = await (query as any).connect?.();

  if (!client) {
    console.warn(
      '[judges.service] No transaction support in db.ts — running inline. ' +
        'Add a `connect()` method or a `withTransaction` helper.',
    );
    return fn(query);
  }

  const run = (text: string, params?: any[]) => client.query(text, params);

  try {
    await run('BEGIN');
    const result = await fn(run);
    await run('COMMIT');
    return result;
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Public reads ────────────────────────────────────────────────────────────

/**
 * List published judges. Paginated. Optional free-text search across
 * name, station, and title; optional region filter.
 *
 * Ordered by name ASC — alphabetical. A bench listing reads better
 * alphabetically than by any other criterion. If you'd rather rank the
 * Principal Judge first, add a `rank` column and order by it, then by
 * name.
 */
export const listPublishedJudges = async (
  options: ListJudgesQuery['query'],
): Promise<{ items: PublicJudgeSummary[]; total: number }> => {
  const { search, region, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [`status = 'published'`];
  const params: any[] = [];

  if (search) {
    params.push(`%${search}%`);
    // Search spans name, station, and title. The mock's search
    // placeholder says "by judge name or station"; title is included
    // because searching "Principal Judge" should surface that record.
    conditions.push(
      `(name ILIKE $${params.length}
        OR station ILIKE $${params.length}
        OR title ILIKE $${params.length})`,
    );
  }

  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, pageRes] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM judges ${where}`, params),
    query(
      `SELECT ${SUMMARY_COLUMNS}
         FROM judges
         ${where}
         ORDER BY name ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: pageRes.rows.map(mapJudgeSummary).map(toPublicSummary),
    total: countRes.rows[0].total,
  };
};

/**
 * Read one published judge by id. Throws 404 for anything that isn't
 * published.
 */
export const getPublishedJudgeById = async (id: string): Promise<PublicJudge> => {
  const result = await query(
    `SELECT * FROM judges WHERE id = $1 AND status = 'published'`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('Judge record not found.', 404);
  }
  return toPublic(mapJudgeRow(result.rows[0]));
};

// ─── Admin reads ─────────────────────────────────────────────────────────────

/**
 * List all judges regardless of status, alphabetical. Used by the
 * admin index page.
 */
export const listAllJudges = async (): Promise<JudgeSummary[]> => {
  const result = await query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM judges
       ORDER BY name ASC`,
  );
  return result.rows.map(mapJudgeSummary);
};

/**
 * List judges waiting on review. Super admin's queue.
 */
export const listPendingJudges = async (): Promise<JudgeSummary[]> => {
  const result = await query(
    `SELECT ${SUMMARY_COLUMNS}
       FROM judges
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
  );
  return result.rows.map(mapJudgeSummary);
};

/**
 * Read any judge by id, regardless of status. Used by the admin editor
 * and the review panel.
 */
export const getJudgeById = async (id: string): Promise<Judge> => {
  const result = await query(`SELECT * FROM judges WHERE id = $1`, [id]);
  if (!result.rowCount) {
    throw new AppError('Judge record not found.', 404);
  }
  return mapJudgeRow(result.rows[0]);
};

// ─── Admin writes ────────────────────────────────────────────────────────────

/**
 * Create a new draft judge record. The caller's id and role are stamped
 * on the row for the audit trail.
 *
 * `image` is the result of `uploadBuffer()` in the controller, or `null`
 * if no portrait was uploaded. It is stored as two columns
 * (`image_url` + `image_public_id`) so a later replace can delete the
 * old asset by public id.
 */
export const createJudge = async (
  userId: string,
  role: Role,
  input: JudgeInputPayload,
  image: ImageAsset | null,
): Promise<Judge> => {
  const result = await query(
    `INSERT INTO judges
       (name, title, station, region, appointed_year, bio,
        education, specializations,
        image_url, image_public_id,
        status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5, $6,
             $7::jsonb, $8::jsonb,
             $9, $10,
             'draft', $11, $12)
     RETURNING *`,
    [
      input.name,
      input.title,
      input.station,
      input.region,
      input.appointedYear,
      input.bio,
      JSON.stringify(input.education ?? []),
      JSON.stringify(input.specializations ?? []),
      image?.url ?? null,
      image?.publicId ?? null,
      userId,
      role,
    ],
  );
  return mapJudgeRow(result.rows[0]);
};

/**
 * Update a judge record the caller owns. Only drafts and rejected
 * records can be edited — once pending, the content is frozen for
 * review; once published, use a super_admin action or unpublish (not
 * implemented).
 *
 * Partial update: only fields present in `input` are changed.
 *
 * Image semantics:
 *   - `image === undefined` → leave the existing portrait alone.
 *   - `image === null`      → clear the portrait (row set to NULLs,
 *                             old asset deleted from Cloudinary).
 *   - `image` is an asset   → replace the portrait (row overwritten,
 *                             old asset deleted from Cloudinary).
 *
 * The controller uploads any new asset before calling this. This
 * function only performs the DB write and the *old* asset cleanup.
 * Order is: upload (controller) → DB write → delete old (here). If the
 * DB write throws, the new asset is orphaned in Cloudinary but the old
 * one is intact — recoverable, and never a data-loss scenario.
 *
 * The two JSONB arrays are serialized with `JSON.stringify` and cast
 * with `::jsonb`. Passing a raw JS array to pg works too, but the
 * explicit cast guarantees the parameter is treated as JSONB and not
 * as a Postgres array literal — the two look similar and it's a subtle
 * bug to chase down.
 */
export const updateJudge = async (
  userId: string,
  judgeId: string,
  input: UpdateJudgeInputSchema['payload'],
  image: ImageAsset | null | undefined,
): Promise<Judge> => {
  const existing = await getJudgeById(judgeId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only edit your own judge records.', 403);
  }

  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected judge records can be edited.',
      409,
    );
  }

  const fields: string[] = [];
  const params: any[] = [];

  const set = (column: string, value: any, cast?: string) => {
    params.push(value);
    const placeholder = `$${params.length}`;
    fields.push(`${column} = ${cast ? `${placeholder}::${cast}` : placeholder}`);
  };

  if (input.name          !== undefined) set('name',           input.name);
  if (input.title         !== undefined) set('title',          input.title);
  if (input.station       !== undefined) set('station',        input.station);
  if (input.region        !== undefined) set('region',         input.region);
  if (input.appointedYear !== undefined) set('appointed_year', input.appointedYear);
  if (input.bio           !== undefined) set('bio',            input.bio);
  if (input.education     !== undefined) {
    set('education', JSON.stringify(input.education), 'jsonb');
  }
  if (input.specializations !== undefined) {
    set('specializations', JSON.stringify(input.specializations), 'jsonb');
  }

  // Image: three states. `undefined` means "not provided" — leave
  // alone. `null` means "clear". An asset means "replace".
  const hasImageChange = image !== undefined;
  if (hasImageChange) {
    set('image_url',       image?.url ?? null);
    set('image_public_id', image?.publicId ?? null);
  }

  if (fields.length === 0) {
    // Nothing to write. Return the existing record without touching
    // Cloudinary — the old asset is still correct.
    return existing;
  }

  fields.push(`updated_at = NOW()`);
  params.push(judgeId);

  const result = await query(
    `UPDATE judges
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  const updated = mapJudgeRow(result.rows[0]);

  // Delete the old asset *after* the DB write commits. Fire-and-forget
  // — a Cloudinary failure here is a cleanup issue, not a correctness
  // issue, and must not turn a successful update into an error.
  if (hasImageChange && existing.image?.publicId) {
    void deleteAsset(existing.image.publicId).catch((err) => {
      console.warn(
        `[judges.service] Failed to delete old portrait ` +
          `(publicId=${existing.image?.publicId}) after update: `,
        err,
      );
    });
  }

  return updated;
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitJudge = async (
  userId: string,
  judgeId: string,
): Promise<Judge> => {
  const existing = await getJudgeById(judgeId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own judge records.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected judge records can be submitted for review.',
      409,
    );
  }

  const result = await query(
    `UPDATE judges
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [judgeId],
  );
  return mapJudgeRow(result.rows[0]);
};

/**
 * Delete a judge record. Only the owner can delete it, and only while
 * it's still a draft or rejected. Pending and published records are
 * immutable from the admin's side.
 *
 * Cloudinary cleanup is fire-and-forget after the DB delete. If it
 * fails, the row is still gone (correct) and the asset is orphaned
 * (acceptable). Reversing the order — delete asset first, then row —
 * would lose the portrait if the DB delete then failed, which is
 * worse.
 */
export const deleteJudge = async (
  userId: string,
  judgeId: string,
): Promise<void> => {
  const existing = await getJudgeById(judgeId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only delete your own judge records.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected judge records can be deleted.',
      409,
    );
  }

  await query('DELETE FROM judges WHERE id = $1', [judgeId]);

  if (existing.image?.publicId) {
    void deleteAsset(existing.image.publicId).catch((err) => {
      console.warn(
        `[judges.service] Failed to delete portrait ` +
          `(publicId=${existing.image?.publicId}) after delete: `,
        err,
      );
    });
  }
};

// ─── Super admin review ──────────────────────────────────────────────────────

/**
 * Approve a pending judge record. Moves it to published, stamps
 * published_at (first time only), records the reviewer.
 *
 * Single-statement UPDATE — no transaction needed. If you later add a
 * rule like "at most one Principal Judge", this becomes the first
 * place that needs `withTransaction`.
 */
export const approveJudge = async (
  reviewerId: string,
  reviewerRole: Role,
  judgeId: string,
  reviewNote?: string | null,
): Promise<Judge> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve judge records.', 403);
  }

  const existing = await getJudgeById(judgeId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending judge records can be approved.', 409);
  }

  const result = await query(
    `UPDATE judges
        SET status = 'published',
            published_at = COALESCE(published_at, NOW()),
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote ?? null, judgeId],
  );
  return mapJudgeRow(result.rows[0]);
};

/**
 * Reject a pending judge record. Moves it to rejected; nothing is
 * published. The note is required by the validator, so it's always
 * present here.
 */
export const rejectJudge = async (
  reviewerId: string,
  reviewerRole: Role,
  judgeId: string,
  reviewNote: string,
): Promise<Judge> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject judge records.', 403);
  }

  const existing = await getJudgeById(judgeId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending judge records can be rejected.', 409);
  }

  const result = await query(
    `UPDATE judges
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, judgeId],
  );
  return mapJudgeRow(result.rows[0]);
};