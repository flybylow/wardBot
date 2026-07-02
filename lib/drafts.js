import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const ATLAS_TURN5_PATHS = [
  join(__dirname, '..', 'emails', 'atlas-turn5.txt'),
  join(__dirname, '..', '..', 'trustgraph', 'deploy', 'examples', 'contact-briefs', 'atlas-turn5-email.txt'),
]

function atlasTurn5Path() {
  for (const path of ATLAS_TURN5_PATHS) {
    if (existsSync(path)) return path
  }
  return null
}

/** @param {string} raw */
function parseDraftFile(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const meta = { to: '', subject: '', replyTo: '' }
  const bodyLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# To:')) {
      meta.to = trimmed.slice(5).trim()
      continue
    }
    if (trimmed.startsWith('# Subject:')) {
      meta.subject = trimmed.slice(10).trim()
      continue
    }
    if (trimmed.startsWith('# Reply-To:')) {
      meta.replyTo = trimmed.slice(11).trim()
      continue
    }
    if (trimmed.startsWith('#')) continue
    bodyLines.push(line)
  }

  const body = bodyLines.join('\n').trim()
  return { ...meta, body }
}

export function listDrafts() {
  const drafts = []
  if (atlasTurn5Path()) {
    drafts.push({
      id: 'atlas-turn5',
      label: 'Atlas Turn 5',
      description: 'Seven-section candidate profile for agents@jeroen.md',
    })
  }
  return drafts
}

export function readDraft(id) {
  if (id !== 'atlas-turn5') return null
  const path = atlasTurn5Path()
  if (!path) return null
  const parsed = parseDraftFile(readFileSync(path, 'utf8'))
  if (!parsed.body) return null
  return { id: 'atlas-turn5', path, ...parsed }
}
