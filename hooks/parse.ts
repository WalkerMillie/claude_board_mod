import type { WorkBoard, WorkBoardItem } from '../types'

const SECTIONS: Record<string, WorkBoardItem['group']> = {
  '활성 작업': 'active',
  '보류·미착수': 'hold',
}

const LINK = /\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)\s]+\.md)\)/g

/** The section a `## ` heading opens, or null for one the ★ board does not show. */
export function sectionOf(heading: string): WorkBoardItem['group'] | null {
  for (const [name, group] of Object.entries(SECTIONS)) if (heading.includes(name)) return group
  return null
}

function clean(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
}

/** A heading as the board shows it: no emoji, ★ or trailing `(…)`. */
export function headingOf(line: string): string {
  return clean(line.replace(/^#+\s*/, ''))
    .replace(/[★🔴\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}

/** MM-DD from a YYYYMMDD in a file name (`project_x_20261013.md`). */
export function fileDate(file: string): string | null {
  const m = file.match(/(?:^|[_-])20\d{2}(\d{2})(\d{2})(?=[_.-])/)
  return m ? `${m[1]}-${m[2]}` : null
}

/** One link of an index line: date, headline, what is left, and the 🔴 cautions. */
export function itemOf(
  label: string,
  file: string,
  group: WorkBoardItem['group'],
  section = '',
  after = '',
): WorkBoardItem {
  const text = clean(label)
  const isStar = group === 'hold' || text.includes('★')
  const body = text.replace(/★/g, '').trim()
  const dated = body.match(/^(\d{1,2}-\d{2})\s+(.*)$/)
  const date = dated?.[1] ? dated[1].padStart(5, '0') : fileDate(file)
  const rest = dated?.[2] ?? body
  const [head = '', ...tail] = rest.split(' — ')
  const parts = [...tail.join(' — ').split(/\s+·\s+/), clean(after).replace(/^[—–-]\s*/, '')]
    .map(p => p.trim())
    .filter(Boolean)
  // A 🔴 glued inside a 남음 list (`…·🔴알림 봇 미확인`) is a caution, not a step.
  const left = parts.map(p => p.match(/남음\s*=\s*(.+)$/)?.[1]?.split(/·?🔴/) ?? [])
  const remaining = left.map(l => l[0]?.trim() ?? '').filter(Boolean)
  const cautions = [
    ...parts.filter(p => p.startsWith('🔴')).map(p => p.replace(/^🔴\s*/, '')),
    ...left.flatMap(l => l.slice(1).map(c => c.trim())).filter(Boolean),
  ]
  return {
    id: file,
    file,
    group,
    section,
    date,
    title: head.trim(),
    summary: parts.filter(p => !p.startsWith('🔴') && !/남음\s*=/.test(p)).join(' · '),
    remaining,
    cautions,
    isStar,
  }
}

function newestFirst(items: WorkBoardItem[]): WorkBoardItem[] {
  const order = (i: WorkBoardItem) => i.date ?? '00-00'
  return items
    .map((item, n) => ({ item, n }))
    .sort((a, b) => order(b.item).localeCompare(order(a.item)) || a.n - b.n)
    .map(x => x.item)
}

/**
 * The board of a MEMORY.md. An index with 활성 작업 / 보류·미착수 sections shows
 * its ★ lines newest first; any other shows every linked line, in file order.
 */
export function parseBoard(markdown: string): WorkBoard {
  const lines = markdown.split('\n')
  const isStar = lines.some(l => l.startsWith('## ') && sectionOf(l.slice(3)))
  const items: WorkBoardItem[] = []
  let group: WorkBoardItem['group'] | null = isStar ? null : 'active'
  let section = ''
  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = headingOf(line)
      group = isStar ? sectionOf(line.slice(3)) : 'active'
      continue
    }
    if (!group || !/^\s*[-*] /.test(line)) continue
    const links = [...line.matchAll(LINK)]
    // An active line is one task (its extra links are side notes); a held line lists several.
    for (const m of group === 'active' ? links.slice(0, 1) : links) {
      const [whole, label = '', file = ''] = m
      const after = group === 'active' ? line.slice((m.index ?? 0) + whole.length).replace(/\[[^\]]*\]\([^)]*\)/g, '') : ''
      const item = itemOf(label, file, group, section, after)
      if ((item.isStar || !isStar) && !items.some(i => i.id === item.id)) items.push(item)
    }
  }
  if (!isStar) return { mode: 'all', active: items, hold: [] }
  const sorted = newestFirst(items)
  return {
    mode: 'star',
    active: sorted.filter(i => i.group === 'active'),
    hold: sorted.filter(i => i.group === 'hold'),
  }
}

/** A topic file's body without its frontmatter. */
export function bodyOf(markdown: string): string {
  const m = markdown.match(/^---\n[\s\S]*?\n---\n?/)
  return (m ? markdown.slice(m[0].length) : markdown).trim()
}

/** The date in KST as YYYY-MM-DD, for once-a-day decisions. */
export function kstDay(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
}

/**
 * Days from an MM-DD back to today (KST), the year taken as the latest one
 * that does not put it in the future.
 */
export function daysAgo(mmdd: string, nowMs: number): number {
  const today = kstDay(nowMs)
  const year = Number(today.slice(0, 4))
  const at = (y: number) => Date.parse(`${y}-${mmdd}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  const t = at(year) > now ? at(year - 1) : at(year)
  return Math.round((now - t) / 86_400_000)
}

/** The recency band a dated item falls in. */
export function bandOf(date: string | null, nowMs: number): string {
  if (!date) return '날짜 없음'
  const d = daysAgo(date, nowMs)
  if (d <= 0) return '오늘'
  if (d === 1) return '어제'
  if (d <= 7) return '이번 주'
  if (d <= 31) return '이번 달'
  return '그 이전'
}

/** The folder name Claude Code keeps a project's memory under: `/a/b.c` → `-a-b-c`. */
export function projectKey(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The directory and each one above it, deepest first, the root left out. */
export function ancestorsOf(path: string): string[] {
  const out: string[] = []
  let p = path.replace(/\/+$/, '')
  while (p && p !== '/') {
    out.push(p)
    p = p.slice(0, p.lastIndexOf('/'))
  }
  return out
}

/** The items a filter and a search leave, the search over every text of an item. */
export function filterItems(
  items: WorkBoardItem[],
  filter: 'all' | 'left' | 'caution' | 'hold',
  query: string,
): WorkBoardItem[] {
  const q = query.trim().toLowerCase()
  return items.filter(i => {
    if (filter === 'left' && !i.remaining.length) return false
    if (filter === 'caution' && !i.cautions.length) return false
    if (!q) return true
    return [i.title, i.summary, i.section, i.file, ...i.remaining, ...i.cautions].some(t => t.toLowerCase().includes(q))
  })
}
