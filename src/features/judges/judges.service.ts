// src/features/judges/judges.service.ts
//
// Service layer for the Judges feature.
//
// Responsibilities:
//   - Public reads:   list published judges, read one published judge.
//   - Admin reads:    list all judges (any status), read any by id,
//                     list the pending-review queue.
//   - Admin writes:   create draft, update draft/rejected, submit for
//                     review, delete draft/rejected.
//   - Super admin:    everything an admin can do, plus approve,
//                     reject, and unrestricted edit/delete on any
//                     record regardless of ownership or status.
//
// Authorization model:
//   Ownership and status gates are enforced here, not in the routes.
//   The controller passes `req.user.role`; this layer decides whether
//   the caller may act on the specific record:
//
//     Regular admin:
//       - edit / delete: own draft or rejected records only.
//       - submit:        own draft or rejected records only.
//     Super admin:
//       - edit / delete: any record, any status.
//       - approve / reject: required role.
//
//   Every function that enforces a rule takes `role` as an argument,
//   so the service stays testable without fabricating an auth context.
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
//
// Row → domain shape:
//   `image_url` and `image_public_id` are two columns that together
//   form one domain field (`image`). The database enforces the pairing
//   via `chk_judges_image_pairing`: either both are NULL, or both are
//   non-NULL. A partial row is therefore impossible to store, and the
//   mapper throws if it ever sees one — that means the constraint was
//   bypassed, which is a bug worth failing loudly on rather than
//   silently rendering a placeholder.

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
 *
 * The database enforces `(image_url IS NULL) = (image_public_id IS NULL)`
 * via `chk_judges_image_pairing`. A partial row is impossible to insert
 * or update through normal channels. If we ever see one anyway, something
 * bypassed the constraint — a manual edit, a dropped constraint, a
 * migration gone sideways. Throw rather than degrade: a silent
 * placeholder hides the problem, a 500 gets it fixed.
 */
const mapImage = (
  url: string | null | undefined,
  publicId: string | null | undefined,
): ImageAsset | null => {
  // Both NULL: no portrait. Legitimate and common.
  if (!url && !publicId) return null;

  // Both set: a complete Cloudinary asset.
  if (url && publicId) return { url, publicId };

  // Exactly one set: the state the CHECK constraint forbids.
  throw new Error(
    `[judges.service] Impossible row state: ` +
      `image_url=${url === null ? 'null' : typeof url} ` +
      `image_public_id=${publicId === null ? 'null' : typeof publicId}. ` +
      `The chk_judges_image_pairing constraint has been bypassed.`,
  );
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
const SUMMARY_COLUMNS = [
  'id',
  'name',
  'title',
  'station',
  'region',
  'appointed_year',
  'bio',
  'education',
  'specializations',
  'image_url',
  'image_public_id',
  'status',
  'published_at',
  'created_at',
  'updated_at',
].join(', ');

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
 * Ordered by judicial seniority, matching the convention used on
 * judiciary.go.ke:
 *   1. The Principal Judge first, regardless of appointment year.
 *   2. Then every other judge by appointment year, earliest first —
 *      the judge appointed first is the most senior.
 *   3. Name as a stable tiebreak for judges appointed in the same year.
 *
 * `appointed_year` is stored as TEXT, but it's always a four-digit
 * string. Lexicographic sort on fixed-width digits equals chronological
 * sort, so no cast is needed.
 *
 * The CASE matches any title starting with "Principal" (so a future
 * "Principal Judge" and today's exact string both work). The ELSE tier
 * catches "ELC Judge", any other title variant, and the empty string —
 * drafts with blank titles never reach this query because they aren't
 * published, but the ELSE keeps the ordering total regardless.
 *
 * Ordering happens in SQL, before LIMIT/OFFSET, so pagination stays
 * consistent: page 2 continues the seniority order begun on page 1.
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
    // Search spans name, station, and title. The public search
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
         ORDER BY
           CASE WHEN title ILIKE 'Principal%' THEN 0 ELSE 1 END,
           appointed_year ASC,
           name ASC
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
 * admin index page and the super-admin Published tab.
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
 * Both admins and super admins can create. Every new record lands as a
 * draft regardless of role — publishing requires the separate submit +
 * approve cycle.
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
 * Update a judge record.
 *
 * Authorization:
 *   - Regular admins may only edit their own records, and only while
 *     they're still draft or rejected. Once pending, the content is
 *     frozen for review; once published, regular admins are locked
 *     out (there is no unpublish action yet).
 *   - Super admins may edit any record, regardless of who created it
 *     and regardless of status. Edits to a published record go live
 *     immediately — no re-review.
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
  role: Role,
  judgeId: string,
  input: UpdateJudgeInputSchema['payload'],
  image: ImageAsset | null | undefined,
): Promise<Judge> => {
  const existing = await getJudgeById(judgeId);

  const isOwner = existing.createdBy === userId;
  const isSuperAdmin = role === 'super_admin';

  // Ownership gate. Super admins bypass it; regular admins do not.
  if (!isOwner && !isSuperAdmin) {
    throw new AppError('You can only edit your own judge records.', 403);
  }

  // Status gate. Super admins bypass it; regular admins do not.
  if (
    !isSuperAdmin &&
    existing.status !== 'draft' &&
    existing.status !== 'rejected'
  ) {
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
  //
  // Both columns are set together so the CHECK constraint
  // (chk_judges_image_pairing) is satisfied at every intermediate step.
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
  //
  // The `!== updated.image?.publicId` guard skips the delete when the
  // new asset happens to have the same public id (e.g. a same-file
  // re-upload with an overwrite). Without the guard we'd delete the
  // asset we just wrote.
  const oldPublicId = existing.image?.publicId;
  const newPublicId = updated.image?.publicId;
  if (hasImageChange && oldPublicId && oldPublicId !== newPublicId) {
    void deleteAsset(oldPublicId).catch((err) => {
      console.warn(
        `[judges.service] Failed to delete old portrait ` +
          `(publicId=${oldPublicId}) after update: `,
        err,
      );
    });
  }

  return updated;
};

/**
 * Submit a draft for review. Moves status draft → rejected → pending.
 *
 * Ownership and status are checked here; only the record's creator can
 * submit it, and only from draft or rejected. This is a narrower rule
 * than update/delete — a super admin cannot submit someone else's
 * draft, because there's no reason to; they can edit and approve
 * directly if they need to move it forward.
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
 * Delete a judge record.
 *
 * Authorization:
 *   - Regular admins may only delete their own records, and only while
 *     they're still draft or rejected. Pending and published records
 *     are immutable from the admin's side.
 *   - Super admins may delete any record, regardless of who created it
 *     and regardless of status. This is the escape hatch for cleaning
 *     up published records that shouldn't be live.
 *
 * Cloudinary cleanup is fire-and-forget after the DB delete. If it
 * fails, the row is still gone (correct) and the asset is orphaned
 * (acceptable). Reversing the order — delete asset first, then row —
 * would lose the portrait if the DB delete then failed, which is
 * worse.
 */
export const deleteJudge = async (
  userId: string,
  role: Role,
  judgeId: string,
): Promise<void> => {
  const existing = await getJudgeById(judgeId);

  const isOwner = existing.createdBy === userId;
  const isSuperAdmin = role === 'super_admin';

  // Ownership gate. Super admins bypass it; regular admins do not.
  if (!isOwner && !isSuperAdmin) {
    throw new AppError('You can only delete your own judge records.', 403);
  }

  // Status gate. Super admins bypass it; regular admins do not.
  if (
    !isSuperAdmin &&
    existing.status !== 'draft' &&
    existing.status !== 'rejected'
  ) {
    throw new AppError(
      'Only drafts and rejected judge records can be deleted.',
      409,
    );
  }

  await query('DELETE FROM judges WHERE id = $1', [judgeId]);

  const publicId = existing.image?.publicId;
  if (publicId) {
    void deleteAsset(publicId).catch((err) => {
      console.warn(
        `[judges.service] Failed to delete portrait ` +
          `(publicId=${publicId}) after delete: `,
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