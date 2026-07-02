#!/usr/bin/env node
/**
 * Local mail UI + API for WardBot (send, inbox, SMTP verify).
 * Binds to 127.0.0.1 only — not for public exposure.
 */
import 'dotenv/config';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOW_SEND,
  DRY_RUN,
  MAIL_UI_HOST,
  MAIL_UI_PORT,
  getBotAddress,
  getFromHeader,
  mailConfigured,
  imapConfigured,
} from './lib/config.js';
import { sendOutbound, listInbox, listMailbox, verifySmtp } from './lib/mail.js';
import { appendSendProvenance } from './lib/provenance.js';
import { getMailboxCache, syncMailbox, startMailboxPolling } from './lib/mailbox-cache.js';
import { getAppNavItems } from './lib/nav.js';
import { listDrafts, readDraft } from './lib/drafts.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(pathname, res) {
  const filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    json(res, 404, { error: 'Not found' });
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/nav') {
    return json(res, 200, { items: getAppNavItems({ current: 'mail' }) });
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    return json(res, 200, {
      botAddress: getBotAddress(),
      from: getFromHeader(),
      smtpAuthUser: process.env.SMTP_USER ?? null,
      mailConfigured: mailConfigured(),
      imapConfigured: imapConfigured(),
      dryRunDefault: DRY_RUN,
      allowSend: ALLOW_SEND,
      pollIntervalMs: Number(process.env.MAIL_POLL_INTERVAL_MS) || 30_000,
      mailbox: getMailboxCache(),
    });
  }

  if (req.method === 'GET' && pathname === '/api/verify-smtp') {
    if (!mailConfigured()) {
      return json(res, 503, { error: 'SMTP not configured in .env' });
    }
    try {
      const result = await verifySmtp();
      return json(res, 200, result);
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/inbox') {
    if (!imapConfigured()) {
      return json(res, 503, { error: 'IMAP not configured in .env' });
    }
    try {
      const url = new URL(req.url, `http://${MAIL_UI_HOST}`);
      const limit = Number(url.searchParams.get('limit')) || 30;
      const botOnly = url.searchParams.get('all') !== '1';
      const force = url.searchParams.get('refresh') === '1';

      if (force) await syncMailbox({ limit, botOnly });
      else if (!getMailboxCache().syncedAt) await syncMailbox({ limit, botOnly });

      const cached = getMailboxCache();
      return json(res, 200, {
        messages: cached.messages,
        botAddress: getBotAddress(),
        botOnly,
        syncedAt: cached.syncedAt,
        syncing: cached.syncing,
        lastError: cached.lastError,
        pollIntervalMs: Number(process.env.MAIL_POLL_INTERVAL_MS) || 30_000,
      });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/drafts') {
    return json(res, 200, { drafts: listDrafts() });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/drafts/')) {
    const id = pathname.slice('/api/drafts/'.length)
    const draft = readDraft(id)
    if (!draft) return json(res, 404, { error: 'Draft not found' })
    return json(res, 200, { draft })
  }

  if (req.method === 'POST' && pathname === '/api/send') {
    if (!mailConfigured()) {
      return json(res, 503, { error: 'SMTP not configured in .env' });
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    const to = String(body.to ?? '').trim();
    const subject = String(body.subject ?? '').trim();
    const text = String(body.body ?? body.text ?? '').trim();
    const originalDraft = String(body.originalDraft ?? '').trim();
    const dryRun = body.dryRun !== false && body.send !== true;

    if (!to || !subject || !text) {
      return json(res, 400, { error: 'to, subject, and body are required' });
    }

    const wasEdited = Boolean(originalDraft) && text !== originalDraft;
    const sentAt = new Date().toISOString();

    appendSendProvenance({
      id: `send-${Date.now()}`,
      event: 'email-send',
      to,
      subject,
      status: wasEdited ? 'conv:WardHandEdit' : 'conv:Confirmed',
      editedBy: wasEdited ? 'ward' : null,
      draftedBy: 'wardbot',
      sentAt,
      source: 'wardbot-send-ui',
      diffDetected: wasEdited,
      dryRun,
      bodyLength: text.length,
    });

    const preview = {
      from: getFromHeader(),
      replyTo: getBotAddress(),
      to,
      subject,
      body: text,
    };

    if (dryRun) {
      return json(res, 200, { ok: true, dryRun: true, preview });
    }

    if (!ALLOW_SEND) {
      return json(res, 403, {
        error: 'Live send disabled. Set ALLOW_SEND=true in .env or use dry run.',
        preview,
      });
    }

    try {
      const sent = await sendOutbound({ to, subject, body: text });
      return json(res, 200, { ok: true, dryRun: false, sent });
    } catch (err) {
      return json(res, 502, { error: err.message, preview });
    }
  }

  json(res, 404, { error: 'Not found' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? MAIL_UI_HOST}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(pathname, res);
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

server.listen(MAIL_UI_PORT, MAIL_UI_HOST, () => {
  console.log(`wardbot mail UI: http://${MAIL_UI_HOST}:${MAIL_UI_PORT}`);
  console.log(`From: ${getFromHeader()} (SMTP auth: ${process.env.SMTP_USER})`);
  console.log(`ALLOW_SEND=${ALLOW_SEND} — uncheck dry run in UI only sends when true`);
  startMailboxPolling();
});
