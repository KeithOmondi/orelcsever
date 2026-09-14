// src/features/documents/documents.service.ts
//
// Service layer for the Documents feature.
//
// Responsibilities:
//   - Public reads: list published documents, read one published
//     document.
//   - Admin reads: list all documents (any status), read any by id.
//   - Admin writes: create draft, update draft, submit for review,
//     delete a draft.
//   - Super admin writes: approve (→ published), reject (→ rejected).
//
// Nothing here talks HTTP. Controllers call these functions and shape
// the response. All row → domain mapping lives here.
//
// Files:
//   Every document references a Cloudinary asset via `filePublicId`.
//   The database has no foreign key that reaches into Cloudinary, so
//   the service is responsible for destroying files when it removes
//   or replaces the row that pointed at them. See `cleanupFile`.
//
// Dates:
//   `issued_at` is a DATE column. pg returns DATE as a Date object at
//   UTC midnight, which we map to a `YYYY-MM-DD` string before sending
//   it back. This is the only place `Date` appears for that field — the
//   wire format stays a string end to end, so no timezone drift.

import { query } from '../../config/db';
import { AppError } from '../../utils/Apperror';
import { deleteAsset } from '../../utils/upload';
import type { Role } from '../../types/roles';
import type {
  Document,
  DocumentSummary,
  PublicDocument,
  PublicDocumentSummary,
} from './documents.types';
import type {
  DocumentInputPayload,
  UpdateDocumentInputSchema,
  ListDocumentsQuery,
} from './documents.validator';

// ─── File cleanup ────────────────────────────────────────────────────────────
//
// Same pattern as the other feature services. Cloudinary assets outlive
// the rows that reference them. Any time the service removes or replaces
// a row's `filePublicId`, the old asset must be destroyed separately.
//
// Fire-and-forget by design. The DB write has already succeeded by the
// time we get here; a Cloudinary hiccup must not roll it back or fail
// the response. `deleteAsset` already treats a missing asset as "gone",
// so a double-delete or a race with a manual cleanup is a no-op.

const cleanupFile = (publicId: string | null): void => {
  if (!publicId) return;
  void deleteAsset(publicId);
};

// ─── Date helpers ────────────────────────────────────────────────────────────
//
// `issued_at` is a DATE column. pg returns DATE as a Date object at
// UTC midnight. To avoid timezone drift when the server isn't in UTC,
// we read the UTC parts and format manually rather than calling
// `toISOString()` on the local-time interpretation.
//
// `toDateOnly` handles both a Date (from pg) and a string (already
// formatted, e.g. from a cached row). Same output shape either way:
// "YYYY-MM-DD".

const toDateOnly = (value: Date | string): string => {
  if (typeof value === 'string') {
    // Already formatted — take the first 10 chars as a defensive trim.
    return value.slice(0, 10);
  }
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ─── Row mappers ─────────────────────────────────────────────────────────────
//
// Every row that comes out of Postgres has snake_case column names.
// Every domain type in documents.types.ts is camelCase. These functions
// are the only place the conversion happens.

const mapDocumentRow = (row: Record<string, any>): Document => ({
  id:            row.id,
  title:         row.title,
  description:   row.description,
  category:      row.category,
  station:       row.station,
  issuedAt:      toDateOnly(row.issued_at),
  fileUrl:       row.file_url,
  filePublicId:  row.file_public_id,
  fileBytes:     Number(row.file_bytes),
  fileSize:      row.file_size,
  status:        row.status,
  publishedAt:   row.published_at,
  createdBy:     row.created_by,
  createdByRole: row.created_by_role,
  reviewedBy:    row.reviewed_by,
  reviewedAt:    row.reviewed_at,
  reviewNote:    row.review_note,
  createdAt:     row.created_at,
  updatedAt:     row.updated_at,
});

const mapDocumentSummary = (
  row: Record<string, any>,
): DocumentSummary => ({
  id:          row.id,
  title:       row.title,
  description: row.description,
  category:    row.category,
  station:     row.station,
  issuedAt:    toDateOnly(row.issued_at),
  fileSize:    row.file_size,
  fileUrl:     row.file_url,
  status:      row.status,
  publishedAt: row.published_at,
  createdAt:   row.created_at,
  updatedAt:   row.updated_at,
});

/**
 * Strips the internal fields before a row is sent to the public.
 * `filePublicId` is omitted — the public reader only needs the URL.
 */
const toPublic = (doc: Document): PublicDocument => {
  const {
    reviewNote,
    reviewedBy,
    reviewedAt,
    createdBy,
    createdByRole,
    filePublicId,
    ...rest
  } = doc;
  return rest;
};

const toPublicSummary = (
  summary: DocumentSummary,
): PublicDocumentSummary => {
  const { status, ...rest } = summary;
  return rest;
};

// ─── Transaction helper ──────────────────────────────────────────────────────
//
// Same shape as the other feature services. Documents have no
// multi-statement writes today, so this is currently unused. It's kept
// here so the pattern stays consistent and a future feature (e.g.
// "replace previous cause list for the same station+week") has a
// ready-made helper.

const withTransaction = async <T>(
  fn: (run: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> => {
  const client = await (query as any).connect?.();

  if (!client) {
    console.warn(
      '[documents.service] No transaction support in db.ts — running inline. ' +
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
 * List published documents. Paginated. Optional free-text search across
 * title, description, and station; optional category and station
 * filters.
 *
 * Always ordered by issued_at DESC — most recent document first. That
 * puts the current year's cause lists and practice directions at the
 * top, with historical Acts and Rules trailing.
 */
export const listPublishedDocuments = async (
  options: ListDocumentsQuery['query'],
): Promise<{ items: PublicDocumentSummary[]; total: number }> => {
  const { search, category, station, page, limit } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [`status = 'published'`];
  const params: any[] = [];

  if (search) {
    params.push(`%${search}%`);
    // Search spans title, description, and station. The mock's search
    // placeholder says "by title or station", so a user typing a
    // station name should surface its documents regardless of what
    // they're called.
    conditions.push(
      `(title ILIKE $${params.length}
        OR description ILIKE $${params.length}
        OR station ILIKE $${params.length})`,
    );
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (station) {
    params.push(station);
    conditions.push(`station = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRes, pageRes] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total FROM documents ${where}`,
      params,
    ),
    query(
      `SELECT id, title, description, category, station,
              issued_at, file_size, file_url, status,
              published_at, created_at, updated_at
         FROM documents
         ${where}
         ORDER BY issued_at DESC NULLS LAST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    items: pageRes.rows.map(mapDocumentSummary).map(toPublicSummary),
    total: countRes.rows[0].total,
  };
};

/**
 * Read one published document by id. Throws 404 for anything that
 * isn't published.
 */
export const getPublishedDocumentById = async (
  id: string,
): Promise<PublicDocument> => {
  const result = await query(
    `SELECT * FROM documents WHERE id = $1 AND status = 'published'`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('Document not found.', 404);
  }
  return toPublic(mapDocumentRow(result.rows[0]));
};

// ─── Admin reads ─────────────────────────────────────────────────────────────

/**
 * List all documents regardless of status, newest issued first. Used
 * by the admin index page.
 */
export const listAllDocuments = async (): Promise<DocumentSummary[]> => {
  const result = await query(
    `SELECT id, title, description, category, station,
            issued_at, file_size, file_url, status,
            published_at, created_at, updated_at
       FROM documents
       ORDER BY issued_at DESC NULLS LAST`,
  );
  return result.rows.map(mapDocumentSummary);
};

/**
 * List documents waiting on review. Super admin's queue.
 */
export const listPendingDocuments = async (): Promise<DocumentSummary[]> => {
  const result = await query(
    `SELECT id, title, description, category, station,
            issued_at, file_size, file_url, status,
            published_at, created_at, updated_at
       FROM documents
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
  );
  return result.rows.map(mapDocumentSummary);
};

/**
 * Read any document by id, regardless of status. Used by the admin
 * editor and the review panel.
 */
export const getDocumentById = async (id: string): Promise<Document> => {
  const result = await query(`SELECT * FROM documents WHERE id = $1`, [id]);
  if (!result.rowCount) {
    throw new AppError('Document not found.', 404);
  }
  return mapDocumentRow(result.rows[0]);
};

// ─── Admin writes ────────────────────────────────────────────────────────────

/**
 * Create a new draft document. The caller's id and role are stamped on
 * the row for the audit trail.
 */
export const createDocument = async (
  userId: string,
  role: Role,
  input: DocumentInputPayload,
): Promise<Document> => {
  const result = await query(
    `INSERT INTO documents
       (title, description, category, station, issued_at,
        file_url, file_public_id, file_bytes, file_size,
        status, created_by, created_by_role)
     VALUES ($1, $2, $3, $4, $5,
             $6, $7, $8, $9,
             'draft', $10, $11)
     RETURNING *`,
    [
      input.title,
      input.description,
      input.category,
      input.station,
      input.issuedAt,
      input.fileUrl,
      input.filePublicId,
      input.fileBytes,
      input.fileSize,
      userId,
      role,
    ],
  );
  return mapDocumentRow(result.rows[0]);
};

/**
 * Update a document the caller owns. Only drafts and rejected
 * documents can be edited — once pending, the content is frozen for
 * review; once published, use a super_admin action or unpublish (not
 * implemented).
 *
 * Partial update: only fields present in `input` are changed.
 *
 * If the client replaces the PDF, the previous Cloudinary asset is
 * destroyed after the UPDATE succeeds. See `cleanupFile`.
 */
export const updateDocument = async (
  userId: string,
  documentId: string,
  input: UpdateDocumentInputSchema['payload'],
): Promise<Document> => {
  const existing = await getDocumentById(documentId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only edit your own documents.', 403);
  }

  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected documents can be edited.',
      409,
    );
  }

  const fields: string[] = [];
  const params: any[] = [];

  const set = (column: string, value: any) => {
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  };

  if (input.title        !== undefined) set('title',          input.title);
  if (input.description  !== undefined) set('description',    input.description);
  if (input.category     !== undefined) set('category',       input.category);
  if (input.station      !== undefined) set('station',        input.station);
  if (input.issuedAt     !== undefined) set('issued_at',      input.issuedAt);
  if (input.fileUrl      !== undefined) set('file_url',       input.fileUrl);
  if (input.filePublicId !== undefined) set('file_public_id', input.filePublicId);
  if (input.fileBytes    !== undefined) set('file_bytes',     input.fileBytes);
  if (input.fileSize     !== undefined) set('file_size',      input.fileSize);

  if (fields.length === 0) {
    return existing;
  }

  // If the client is replacing the file, capture the old public id
  // before the UPDATE so we can clean it up afterwards. Only when the
  // id actually changes — re-saving the same PDF is a no-op on
  // Cloudinary.
  const oldPublicId =
    input.filePublicId !== undefined &&
    input.filePublicId !== existing.filePublicId
      ? existing.filePublicId
      : null;

  fields.push(`updated_at = NOW()`);
  params.push(documentId);

  const result = await query(
    `UPDATE documents
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  cleanupFile(oldPublicId);

  return mapDocumentRow(result.rows[0]);
};

/**
 * Submit a draft for review. Moves status draft → pending.
 */
export const submitDocument = async (
  userId: string,
  documentId: string,
): Promise<Document> => {
  const existing = await getDocumentById(documentId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only submit your own documents.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected documents can be submitted for review.',
      409,
    );
  }

  const result = await query(
    `UPDATE documents
        SET status = 'pending',
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [documentId],
  );
  return mapDocumentRow(result.rows[0]);
};

/**
 * Delete a document. Only the owner can delete it, and only while it's
 * still a draft or rejected. Pending and published documents are
 * immutable from the admin's side.
 *
 * The Cloudinary file referenced by `filePublicId` is destroyed after
 * the row is gone. See `cleanupFile`.
 */
export const deleteDocument = async (
  userId: string,
  documentId: string,
): Promise<void> => {
  const existing = await getDocumentById(documentId);

  if (existing.createdBy !== userId) {
    throw new AppError('You can only delete your own documents.', 403);
  }
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new AppError(
      'Only drafts and rejected documents can be deleted.',
      409,
    );
  }

  await query('DELETE FROM documents WHERE id = $1', [documentId]);

  // After the row is gone, drop the Cloudinary file it referenced.
  // Order matters: a Cloudinary failure leaks one file; the reverse
  // order (file first, row second) would risk a row pointing at a
  // destroyed asset.
  cleanupFile(existing.filePublicId);
};

// ─── Super admin review ──────────────────────────────────────────────────────

/**
 * Approve a pending document. Moves it to published, stamps
 * published_at (first time only), records the reviewer.
 *
 * Single-statement UPDATE — no transaction needed. If you later add a
 * rule like "only one cause list per station per week", this becomes
 * the first place that needs `withTransaction`.
 */
export const approveDocument = async (
  reviewerId: string,
  reviewerRole: Role,
  documentId: string,
  reviewNote?: string | null,
): Promise<Document> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can approve documents.', 403);
  }

  const existing = await getDocumentById(documentId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending documents can be approved.', 409);
  }

  const result = await query(
    `UPDATE documents
        SET status = 'published',
            published_at = COALESCE(published_at, NOW()),
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote ?? null, documentId],
  );
  return mapDocumentRow(result.rows[0]);
};

/**
 * Reject a pending document. Moves it to rejected; nothing is
 * published. The note is required by the validator, so it's always
 * present here.
 */
export const rejectDocument = async (
  reviewerId: string,
  reviewerRole: Role,
  documentId: string,
  reviewNote: string,
): Promise<Document> => {
  if (reviewerRole !== 'super_admin') {
    throw new AppError('Only super admins can reject documents.', 403);
  }

  const existing = await getDocumentById(documentId);
  if (existing.status !== 'pending') {
    throw new AppError('Only pending documents can be rejected.', 409);
  }

  const result = await query(
    `UPDATE documents
        SET status = 'rejected',
            reviewed_by = $1,
            reviewed_at = NOW(),
            review_note = $2,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [reviewerId, reviewNote, documentId],
  );
  return mapDocumentRow(result.rows[0]);
};