import 'dotenv/config';
import { readFileSync } from 'fs';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import { extractText, getDocumentProxy } from 'unpdf';

const {
  IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  BOT_ADDRESS, ANTHROPIC_API_KEY,
} = process.env;

const DRY_RUN = process.env.DRY_RUN !== 'false';
const MAX_ATTACHMENT_CHARS = 12_000;
const MAX_INCOMING_CHARS = 24_000;

const PERSONA = readFileSync(new URL('./ward-persona.md', import.meta.url), 'utf8');

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function clip(text, max = MAX_ATTACHMENT_CHARS) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n[truncated]`;
}

async function extractAttachmentText({ filename, contentType, content }) {
  if (!content?.length) return { status: 'empty', text: null };

  const type = (contentType ?? '').toLowerCase();
  const name = (filename ?? '').toLowerCase();

  if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) {
    return { status: 'extracted', text: clip(content.toString('utf8')) };
  }

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const { text } = await extractText(pdf, { mergePages: true });
      if (!text?.trim()) return { status: 'empty', text: null };
      return { status: 'extracted', text: clip(text) };
    } catch (err) {
      return { status: 'failed', text: null, error: err.message };
    }
  }

  return { status: 'unsupported', text: null };
}

async function buildIncomingText(parsed) {
  const sections = [];
  const body = parsed.text?.trim();
  if (body) sections.push(body);

  const attachments = parsed.attachments ?? [];
  for (const attachment of attachments) {
    const label = attachment.filename ?? 'unnamed';
    const type = attachment.contentType ?? 'unknown';
    const result = await extractAttachmentText(attachment);

    if (result.status === 'extracted' && result.text) {
      sections.push(`--- Attachment: ${label} (${type}) ---\n${result.text}`);
      continue;
    }

    if (result.status === 'failed') {
      sections.push(`--- Attachment: ${label} (${type}) — PDF present but text extraction failed ---`);
      continue;
    }

    if (result.status === 'unsupported') {
      sections.push(`--- Attachment: ${label} (${type}) — format not supported for text extraction ---`);
      continue;
    }

    if (result.status === 'empty') {
      sections.push(`--- Attachment: ${label} (${type}) — no extractable text ---`);
    }
  }

  const combined = sections.join('\n\n').trim();
  return clip(combined, MAX_INCOMING_CHARS);
}

async function draftReply({ from, subject, text }) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: PERSONA,
    messages: [{
      role: 'user',
      content:
        `Incoming email\nFrom: ${from}\nSubject: ${subject}\n\n${text}\n\n` +
        `Draft a reply in Ward's voice. Output only the email body, no subject line.`,
    }],
  });
  return response.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function sendReply(parsed, draftText) {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: BOT_ADDRESS,
    to: parsed.from?.value?.[0]?.address,
    subject: parsed.subject
      ? (parsed.subject.startsWith('Re:') ? parsed.subject : `Re: ${parsed.subject}`)
      : 'Re: (no subject)',
    text: draftText,
    inReplyTo: parsed.messageId,
    references: parsed.messageId,
  });
}

async function checkMailbox() {
  if (!BOT_ADDRESS) throw new Error('Set BOT_ADDRESS in .env');

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: Number(IMAP_PORT) || 993,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const uids = await client.search({
      header: { to: BOT_ADDRESS },
      seen: false,
    });

    if (uids.length === 0) {
      console.log(`[${new Date().toISOString()}] No new mail for ${BOT_ADDRESS}.`);
      return;
    }

    console.log(`[${new Date().toISOString()}] Found ${uids.length} new message(s) for ${BOT_ADDRESS}.`);

    for (const uid of uids) {
      const { source } = await client.fetchOne(uid, { source: true });
      const parsed = await simpleParser(source);
      const incomingText = await buildIncomingText(parsed);
      const attachmentCount = parsed.attachments?.length ?? 0;

      const draft = await draftReply({
        from: parsed.from?.text ?? 'unknown sender',
        subject: parsed.subject ?? '(no subject)',
        text: incomingText,
      });

      console.log('\n' + '─'.repeat(60));
      console.log('From:', parsed.from?.text);
      console.log('Subject:', parsed.subject);
      if (attachmentCount > 0) {
        console.log(`Attachments: ${attachmentCount} (included in context when text could be extracted)`);
      }
      console.log('\nDraft reply:\n');
      console.log(draft);
      console.log('─'.repeat(60));

      if (DRY_RUN) {
        console.log('(DRY_RUN=true — nothing sent, message left unread)');
      } else {
        await sendReply(parsed, draft);
        await client.messageFlagsAdd(uid, ['\\Seen']);
        console.log('Sent and marked as read.');
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 2 * 60 * 1000;

async function run() {
  console.log(`wardbot running. Checking ${BOT_ADDRESS} every ${POLL_INTERVAL_MS / 1000}s. DRY_RUN=${DRY_RUN}. Ctrl+C to stop.`);
  while (true) {
    try {
      await checkMailbox();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] cycle failed:`, err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

run();