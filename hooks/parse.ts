import type { WorkBoard, WorkBoardFilter, WorkBoardItem } from '../types'

const SECTIONS: Record<string, WorkBoardItem['group']> = {
  '활성 작업': 'active',
  '보류·미착수': 'hold',
}

/** Days without an edit before a work memo counts as stale. */
export const STALE_DAYS = 14

const DONE = /((?<!미)완료|해소|닫힘|폐기|머지됨|\b(done|merged|resolved|closed)\b)/i
const EVERGREEN = /^(feedback|user|reference)[_-]/

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
  if (!isStar) return { mode: 'all', active: items, hold: [], tidy: [] }
  const sorted = newestFirst(items)
  return {
    mode: 'star',
    active: sorted.filter(i => i.group === 'active'),
    hold: sorted.filter(i => i.group === 'hold'),
    tidy: [],
  }
}

/**
 * The work lines of an index worth a tidy, newest first: marked done with
 * nothing left, untouched for `staleDays`, or linking a file the folder lacks.
 * `mtimes` maps each file of the folder to its last edit; null when the folder
 * could not be listed, which leaves only the done check. Feedback, user and
 * reference memos never qualify, and on a ★ index only 활성 / 보류 lines do.
 */
export function tidyCandidates(
  markdown: string,
  mtimes: Record<string, number> | null,
  nowMs: number,
  staleDays = STALE_DAYS,
): WorkBoardItem[] {
  const lines = markdown.split('\n')
  const isStar = lines.some(l => l.startsWith('## ') && sectionOf(l.slice(3)))
  const out: WorkBoardItem[] = []
  let group: WorkBoardItem['group'] | null = isStar ? null : 'active'
  let section = ''
  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = headingOf(line)
      group = isStar ? sectionOf(line.slice(3)) : 'active'
      continue
    }
    if (!group || !/^\s*[-*] /.test(line)) continue
    for (const [n, m] of [...line.matchAll(LINK)].entries()) {
      const [whole, label = '', file = ''] = m
      if (EVERGREEN.test(file) || out.some(i => i.id === file)) continue
      const after = n === 0 && group === 'active' ? line.slice((m.index ?? 0) + whole.length).replace(/\[[^\]]*\]\([^)]*\)/g, '') : ''
      const item = itemOf(label, file, group, section, after)
      const reasons: string[] = []
      if (mtimes && !file.includes('/') && !(file in mtimes)) {
        reasons.push('파일 없음')
      } else {
        if (!item.isStar && !item.remaining.length && DONE.test(`${label} ${after}`)) reasons.push('완료 표시')
        const at = mtimes?.[file]
        const days = at ? Math.floor((nowMs - at) / 86_400_000) : 0
        if (days >= staleDays) reasons.push(`${days}일째 수정 없음`)
      }
      if (reasons.length) out.push({ ...item, reason: reasons.join(' · ') })
    }
  }
  return newestFirst(out)
}

/** The request the tidy button sends: the candidates and the rules for moving them. */
export function tidyPrompt(dir: string, items: WorkBoardItem[]): string {
  return [
    `작업 보드에서 고른 메모 정리 후보 ${items.length}건을 정리해 주세요.`,
    '',
    `메모 폴더: ${dir}`,
    '',
    '후보:',
    ...items.map(i => `- ${i.file} — ${i.title} (${i.reason ?? ''})`),
    '',
    '원칙:',
    '- 메모 파일은 지우지 않습니다. MEMORY.md 에서 그 줄을 빼서 아카이브 인덱스로 옮깁니다. MEMORY.md 에 이미 링크된 아카이브 인덱스가 있으면 거기에 붙이고, 없으면 같은 폴더에 archive_index.md 를 만들어 MEMORY.md 맨 위에 링크를 겁니다.',
    '- 후보마다 메모 본문을 읽고 끝난 작업인지 판단합니다. 남은 조치가 있거나 판단이 서지 않으면 옮기지 않고 물어볼 목록에 넣습니다.',
    "- '파일 없음' 후보는 MEMORY.md 에서 그 링크만 정리합니다.",
    '- 같은 주제를 다루는 메모가 겹치면 합치자고 제안만 하고, 합치기 전에 확인을 받습니다.',
    '- MEMORY.md 에 남는 줄은 링크와 ★·🔴 표시를 그대로 둡니다.',
    '- 끝나면 옮긴 것·남긴 것·물어볼 것을 나눠서 짧게 보고합니다.',
  ].join('\n')
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
  filter: WorkBoardFilter,
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
