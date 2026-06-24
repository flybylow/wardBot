# wardbot

Reads mail sent to `wardbot@tabulas.eu` (the alias forwarding into
`ward@tabulas.eu`), drafts a reply with Claude in Ward's voice, and — once
you trust it — sends it.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `IMAP_PASS` / `SMTP_PASS` — your `ward@tabulas.eu` mailbox password (same
  one for both)
- `ANTHROPIC_API_KEY` — from console.anthropic.com

Leave `DRY_RUN=true` for now.

## Run

```bash
npm start
```

It connects, finds unread mail addressed to `wardbot@tabulas.eu` (your
regular mail is ignored — it filters on the To: header), drafts a reply for
each, and prints the draft to the console. Nothing is sent and nothing is
marked as read while `DRY_RUN=true`, so you can run it as many times as you
want while testing.

## Going live

Once a few drafts look right, set `DRY_RUN=false` in `.env`. From then on it
sends the draft automatically and marks the message read.

Before flipping that switch, send yourself a test email to
`wardbot@tabulas.eu` and confirm the reply actually arrives — Combell's SMTP
might enforce that the From address matches the authenticated mailbox
(`ward@tabulas.eu`) rather than the alias (`wardbot@tabulas.eu`). If sending
fails or the From gets silently rewritten, that's the thing to fix first.

## Editing the voice

`ward-persona.md` is the system prompt — plain markdown, edit it directly to
adjust tone, add context, or add rules (e.g. "always cc someone," "never
discuss pricing").

## Running it repeatedly

This is a single-pass script — it checks once and exits. For something
closer to "automatic," run it on a schedule:

```bash
# every 10 minutes, via cron
*/10 * * * * cd /path/to/wardbot && npm start >> wardbot.log 2>&1
```

A future upgrade: swap the one-shot `search()` for IMAP IDLE (imapflow
supports it) to react the moment mail arrives instead of polling.
