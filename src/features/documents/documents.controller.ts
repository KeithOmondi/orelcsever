// src/features/documents/documents.controller.ts
//
// HTTP layer for the Documents feature.
//
// Controllers do four things and nothing else:
//   1. Pull validated data off the request (body / params / query / user).
//   2. Call the service.
//   3. Pass the result to `sendResponse`.
//   4. Let `catchAsync` funnel errors to the global error handler.
//
// No business logic. No SQL. No role checks beyond what the middleware
// already enforced — the service re-verifies authorization anyway.

import { Request, Response } from 'express';
import * as documentsService from './documents.service';
import { catchAsync } from '../../utils/catchasync';
import { sendResponse } from '../../utils/Apiresponse';
import { AppError } from '../../utils/Apperror';
import type { DocumentFileUploadResult } from './documents.types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Express 5 types `req.params.*` as `string | string[]`.
 * Every route we define has single-valued params, so this narrows the
 * type once instead of casting at each callsite.
 */
const param = (req: Request, key: string): string => {
  const value = req.params[key];
  if (typeof value !== 'string') {
    throw new AppError(`${key} must be a single value.`, 400);
  }
  return value;
};

/**
 * Format a byte count into a human-readable size string.
 *
 * Matches the shape the validator accepts: `^\d+(\.\d+)?\s?(B|KB|MB|GB)$`,
 * e.g. "1.4 MB". Rounds to one decimal place above 1 KB.
 *
 * Same implementation as publications.controller.ts. Deliberately not
 * extracted to a shared util yet — two callers is the threshold where
 * you'd normally share, but the file is small and the two features
 * could diverge on formatting rules independently. If a third feature
 * uploads files, extract at that point.
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * GET /documents
 * Public. List published documents. Paginated, searchable, filterable
 * by category and station.
 *
 * Query: { search?, category?, station?, page?, limit? }
 */
export const listPublishedDocumentsHandler = catchAsync(
  async (req: Request, res: Response) => {
    // `validate.middleware.ts` stores parsed query on req.validatedQuery.
    // Fall back to req.query for safety if the middleware wasn't mounted.
    const parsed = (req as any).validatedQuery ?? req.query;
    const result = await documentsService.listPublishedDocuments(parsed);
    sendResponse(res, 200, result);
  },
);

/**
 * GET /documents/:documentId
 * Public. Returns a single published document, or 404.
 */
export const getPublishedDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const document = await documentsService.getPublishedDocumentById(documentId);
    sendResponse(res, 200, document);
  },
);

// ─── Admin — reads ───────────────────────────────────────────────────────────

/**
 * GET /documents/admin/all
 * Admin. Every document regardless of status, newest issued first.
 */
export const listAllDocumentsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const documents = await documentsService.listAllDocuments();
    sendResponse(res, 200, documents);
  },
);

/**
 * GET /documents/admin/pending
 * Admin. Documents waiting on review.
 */
export const listPendingDocumentsHandler = catchAsync(
  async (_req: Request, res: Response) => {
    const documents = await documentsService.listPendingDocuments();
    sendResponse(res, 200, documents);
  },
);

/**
 * GET /documents/admin/:documentId
 * Admin. Full document, any status, including audit fields.
 */
export const getDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const document = await documentsService.getDocumentById(documentId);
    sendResponse(res, 200, document);
  },
);

// ─── Admin — writes ──────────────────────────────────────────────────────────

/**
 * POST /documents/admin
 * Admin. Creates a new draft document.
 *
 * Body: { payload: DocumentInput }
 */
export const createDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const { payload } = req.body;
    const document = await documentsService.createDocument(
      req.user!.id,
      req.user!.role,
      payload,
    );
    sendResponse(res, 201, document, 'Document created.');
  },
);

/**
 * PATCH /documents/admin/:documentId
 * Admin. Updates a document the caller owns. Only drafts and rejected
 * documents can be edited.
 *
 * Body: { payload: Partial<DocumentInput> }
 */
export const updateDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const { payload } = req.body;
    const document = await documentsService.updateDocument(
      req.user!.id,
      documentId,
      payload,
    );
    sendResponse(res, 200, document, 'Document updated.');
  },
);

/**
 * POST /documents/admin/:documentId/submit
 * Admin. Moves a draft or rejected document to pending.
 */
export const submitDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const document = await documentsService.submitDocument(
      req.user!.id,
      documentId,
    );
    sendResponse(res, 200, document, 'Document submitted for review.');
  },
);

/**
 * DELETE /documents/admin/:documentId
 * Admin. Deletes the caller's own draft or rejected document.
 *
 * The service destroys the Cloudinary file referenced by the row.
 */
export const deleteDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    await documentsService.deleteDocument(req.user!.id, documentId);
    sendResponse(res, 200, null, 'Document deleted.');
  },
);

// ─── Super admin — review ────────────────────────────────────────────────────

/**
 * POST /documents/admin/:documentId/approve
 * Super admin. Publishes a pending document.
 *
 * Body: { reviewNote?: string }
 */
export const approveDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const { reviewNote } = req.body;
    const document = await documentsService.approveDocument(
      req.user!.id,
      req.user!.role,
      documentId,
      reviewNote,
    );
    sendResponse(res, 200, document, 'Document published.');
  },
);

/**
 * POST /documents/admin/:documentId/reject
 * Super admin. Declines a pending document without publishing.
 *
 * Body: { reviewNote: string }
 */
export const rejectDocumentHandler = catchAsync(
  async (req: Request, res: Response) => {
    const documentId = param(req, 'documentId');
    const { reviewNote } = req.body;
    const document = await documentsService.rejectDocument(
      req.user!.id,
      req.user!.role,
      documentId,
      reviewNote,
    );
    sendResponse(res, 200, document, 'Document rejected.');
  },
);
// ─── Admin — upload ──────────────────────────────────────────────────────────

/**
 * POST /documents/admin/upload/file
 * Admin. Multipart upload of a single PDF.
 *
 * Body: multipart/form-data with a file in the "file" field.
 *
 * Returns `DocumentFileUploadResult`:
 *     {
 *       url: string,        // Cloudinary secure_url
 *       publicId: string,   // Cloudinary public_id
 *       bytes: number,      // raw byte count
 *       fileSize: string    // human-readable, e.g. "1.4 MB"
 *     }
 *
 * The client copies these onto the document payload as `fileUrl`,
 * `filePublicId`, `fileBytes`, and `fileSize`.
 *
 * No `validate` middleware on this route — the body is multipart, not
 * JSON. Multer's `fileFilter` handles the MIME check before the handler
 * runs.
 */
export const uploadDocumentFileHandler = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError(
        'No file uploaded. Send a file under the "file" field.',
        400,
      );
    }

    // Imported lazily to keep the controller file focused on HTTP.
    const { uploadBuffer } = await import('../../utils/upload');

    const result = await uploadBuffer(
      req.file.buffer,
      { folder: 'documents/files', tags: ['documents'] },
      req.file.mimetype,
    );

    const payload: DocumentFileUploadResult = {
      url: result.url,
      publicId: result.publicId,
      bytes: result.bytes,
      fileSize: formatBytes(result.bytes),
    };

    sendResponse(res, 200, payload, 'File uploaded.');
  },
);