import 'dotenv/config';

export const {
  IMAP_HOST,
  IMAP_PORT,
  IMAP_USER,
  IMAP_PASS,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  BOT_ADDRESS,
  ANTHROPIC_API_KEY,
} = process.env;

export const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME ?? 'WardBot';
export const DRY_RUN = process.env.DRY_RUN !== 'false';
export const MAIL_UI_PORT = Number(process.env.MAIL_UI_PORT) || 3456;
export const MAIL_UI_HOST = process.env.MAIL_UI_HOST ?? '127.0.0.1';

function isLocalMailHost(host) {
  const h = String(host ?? '127.0.0.1').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/** Live send from mail UI — on by default for localhost; set ALLOW_SEND=false to block. */
export const ALLOW_SEND =
  process.env.ALLOW_SEND === 'false'
    ? false
    : process.env.ALLOW_SEND === 'true' || isLocalMailHost(MAIL_UI_HOST);
export const MAIL_POLL_INTERVAL_MS = Number(process.env.MAIL_POLL_INTERVAL_MS) || 30_000;
export const EXPLORER_URL = (process.env.EXPLORER_URL ?? 'http://localhost:3001').replace(/\/$/, '');
export const WARDBOT_URL = (process.env.WARDBOT_URL ?? `http://${MAIL_UI_HOST}:${MAIL_UI_PORT}`).replace(/\/$/, '');

export function getBotAddress() {
  return BOT_ADDRESS ?? SMTP_USER ?? 'wardbot@tabulas.eu';
}

export function getFromHeader() {
  return `${MAIL_FROM_NAME} <${getBotAddress()}>`;
}

export function mailConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && getBotAddress());
}

export function imapConfigured() {
  return Boolean(IMAP_HOST && IMAP_USER && IMAP_PASS);
}
