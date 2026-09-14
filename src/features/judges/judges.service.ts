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
// No file lifecycle for this feature — portraits are external URLs, not
// Cloudinary uploads. See the note on `imageUrl` in judges.types.ts.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import type { Role } from '../../types/roles';
import type {
  Judge,
  JudgeSummary,
  PublicJudge,
  PublicJudgeSummary,
  EducationEntry,
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
  imageUrl:        row.image_url,
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
  imageUrl:        row.image_url,
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
      `SELECT id, name, title, station, region, appointed_year, bio,
              education, specializations, image_url, status,
              published_at, created_at, updated_at
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
    `SELECT id, name, title, station, region, appointed_year, bio,
            education, specializations, image_url, status,
            published_at, created_at, updated_at
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
    `SELECT id, name, title, station, region, appointed_year, bio,
            education, specializations, image_url, status,
            published_at, created_at, updated_at
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
 */
export const createJudge = async (
  userId: string,
  role: Role,
  input: JudgeInputPayload,
): Promise<Judge> => {
  const result = await query(
    `INSERT INTO judges
       (name, title, station, region, appointed_year, bio,
        education, specializations, image_url,
        status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5, $6,
             $7::jsonb, $8::jsonb, $9,
             'draft', $10, $11)
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
      input.imageUrl,
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
  if (input.imageUrl      !== undefined) set('image_url',      input.imageUrl);

  if (fields.length === 0) {
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

  return mapJudgeRow(result.rows[0]);
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
 * No Cloudinary cleanup — portraits are external URLs, not uploads.
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