// WorkDaemon — Gmail Tool
// Sends emails on behalf of an employee via Gmail API or MCP.
// Uses OAuth2 — each employee authorises once.
// MCP path (production): uses connected Gmail MCP server.

import { google } from 'googleapis';
import type { MCPAdapter } from './mcp.js';
import type { SendEmailParams, ToolResult } from './types.js';

export class GmailTool {
  private mcp: MCPAdapter;

  constructor(mcp: MCPAdapter) {
    this.mcp = mcp;
  }

  // ── Send an email ────────────────────────────────────────────────────────
  async send(
    sender_email: string,
    params:       SendEmailParams,
  ): Promise<ToolResult> {
    try {
      // Production path — Gmail MCP server (already connected)
      // OpenClaw handles auth for the sending employee
      if (this.mcp.is_available('gmail')) {
        const result = await this.mcp.call({
          server: 'gmail',
          tool:   'send_email',
          params: {
            to:      params.to,
            subject: params.subject,
            body:    params.body,
            cc:      params.cc ?? [],
          },
        });

        if (result.ok) {
          return {
            ok:      true,
            message: `Email sent to ${params.to} ✓`,
            data:    result.result as Record<string, unknown>,
          };
        }
      }

      // Direct Gmail API fallback
      // Requires individual OAuth2 tokens per employee
      // In production this is handled by OpenClaw's auth layer
      const auth = await this.get_oauth_client(sender_email);
      if (!auth) {
        return {
          ok:      false,
          message: `Gmail not authorised for ${sender_email}. ` +
                   `Ask them to connect Gmail in WorkDaemon settings.`,
        };
      }

      const gmail   = google.gmail({ version: 'v1', auth });
      const message = this.build_mime_message(sender_email, params);
      const encoded = Buffer.from(message).toString('base64url');

      const response = await gmail.users.messages.send({
        userId:      'me',
        requestBody: { raw: encoded },
      });

      return {
        ok:      true,
        message: `Email sent to ${params.to} ✓`,
        data:    { message_id: response.data.id },
      };

    } catch (err) {
      console.error('[Gmail] send failed:', err);
      return {
        ok:      false,
        message: `Failed to send email: ${err}`,
      };
    }
  }

  // ── Build RFC 2822 MIME message ───────────────────────────────────────────
  private build_mime_message(
    from:   string,
    params: SendEmailParams,
  ): string {
    const lines = [
      `From: ${from}`,
      `To: ${params.to}`,
      ...(params.cc?.length ? [`Cc: ${params.cc.join(', ')}`] : []),
      `Subject: ${params.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      params.body,
    ];
    return lines.join('\r\n');
  }

  // ── Get OAuth2 client for a specific employee ────────────────────────────
  // In production: OpenClaw stores and refreshes tokens per employee
  // This is a stub — replace with OpenClaw's token store lookup
  private async get_oauth_client(email: string): Promise<any | null> {
    // TODO: integrate with OpenClaw's OAuth token store
    // const token = await openclaw.auth.get_token(email, 'gmail');
    // if (!token) return null;
    // return build_oauth_client(token);
    return null; // returns null → MCP path is used in production
  }
}
