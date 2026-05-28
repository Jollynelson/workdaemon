// WorkDaemon Brain — Google Drive Connector
// Ingests all supported files from Google Drive into raw documents
// Uses service account — no user OAuth flow required

import { google, drive_v3 } from 'googleapis';
import { config } from '../config.js';
import type { RawDocument } from '../types.js';

export class GoogleDriveConnector {
  private drive: drive_v3.Drive;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.gdrive.client_email,
        private_key:  config.gdrive.private_key,
      },
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  // ── Full scan — pulls ALL supported files (used on onboarding) ───────────
  async full_scan(
    on_progress?: (fetched: number, doc: RawDocument) => void
  ): Promise<RawDocument[]> {
    console.log('[GDrive] Starting full scan...');
    const files   = await this.list_all_files();
    const docs:   RawDocument[] = [];

    for (const file of files) {
      try {
        const doc = await this.read_file(file);
        if (doc) {
          docs.push(doc);
          on_progress?.(docs.length, doc);
        }
      } catch (err) {
        console.warn(`[GDrive] Skipping file ${file.name}: ${err}`);
      }
    }

    console.log(`[GDrive] Full scan complete: ${docs.length} documents`);
    return docs;
  }

  // ── Delta sync — only files modified since last cursor ───────────────────
  async delta_sync(
    since_cursor: string | null,
    on_progress?: (doc: RawDocument) => void,
  ): Promise<{ docs: RawDocument[]; next_cursor: string }> {
    const modified_after = since_cursor
      ? new Date(since_cursor)
      : new Date(Date.now() - 15 * 60 * 1000); // default: last 15 min

    console.log(`[GDrive] Delta sync since: ${modified_after.toISOString()}`);

    const files = await this.list_all_files(modified_after);
    const docs:  RawDocument[] = [];

    for (const file of files) {
      try {
        const doc = await this.read_file(file);
        if (doc) {
          docs.push(doc);
          on_progress?.(doc);
        }
      } catch (err) {
        console.warn(`[GDrive] Skipping ${file.name}: ${err}`);
      }
    }

    return {
      docs,
      next_cursor: new Date().toISOString(),
    };
  }

  // ── List all files in Drive matching supported types ─────────────────────
  private async list_all_files(
    modified_after?: Date
  ): Promise<drive_v3.Schema$File[]> {
    const all_files: drive_v3.Schema$File[] = [];
    let   page_token: string | undefined;

    const mime_query = config.gdrive.supported_types
      .map(t => `mimeType='${t}'`)
      .join(' or ');

    const time_query = modified_after
      ? ` and modifiedTime > '${modified_after.toISOString()}'`
      : '';

    const q = `(${mime_query})${time_query} and trashed = false`;

    do {
      const response = await this.drive.files.list({
        q,
        pageSize:   100,
        pageToken:  page_token,
        fields:     'nextPageToken, files(id, name, mimeType, owners, modifiedTime, webViewLink)',
        ...(config.gdrive.drive_id
          ? { driveId: config.gdrive.drive_id, includeItemsFromAllDrives: true, supportsAllDrives: true, corpora: 'drive' }
          : {}),
      });

      all_files.push(...(response.data.files ?? []));
      page_token = response.data.nextPageToken ?? undefined;

    } while (page_token);

    console.log(`[GDrive] Found ${all_files.length} files`);
    return all_files;
  }

  // ── Read and extract text from a single file ─────────────────────────────
  private async read_file(
    file: drive_v3.Schema$File
  ): Promise<RawDocument | null> {
    if (!file.id || !file.name) return null;

    const mime   = file.mimeType ?? '';
    const author = file.owners?.[0]?.emailAddress ?? 'unknown';
    let   content = '';

    // Google Workspace files — export as plain text
    if (mime.includes('google-apps')) {
      const export_mime = this.get_export_mime(mime);
      if (!export_mime) return null;

      const response = await this.drive.files.export(
        { fileId: file.id, mimeType: export_mime },
        { responseType: 'text' }
      );
      content = response.data as string;

    } else {
      // Binary files (PDF, txt, etc.) — download directly
      const response = await this.drive.files.get(
        { fileId: file.id, alt: 'media' },
        { responseType: 'text' }
      );
      content = response.data as string;
    }

    if (!content || content.trim().length < 20) return null;

    return {
      source_id:  file.id,
      source:     'gdrive',
      title:      file.name,
      content:    content.slice(0, 100_000), // cap at 100k chars per doc
      author,
      url:        file.webViewLink ?? undefined,
      updated_at: file.modifiedTime ?? new Date().toISOString(),
      meta: {
        mime_type: mime,
        owner:     author,
      },
    };
  }

  // ── Map Google MIME type to export format ────────────────────────────────
  private get_export_mime(mime: string): string | null {
    const map: Record<string, string> = {
      'application/vnd.google-apps.document':     'text/plain',
      'application/vnd.google-apps.spreadsheet':  'text/csv',
      'application/vnd.google-apps.presentation': 'text/plain',
    };
    return map[mime] ?? null;
  }
}
