import type { EngineInterface, Register } from 'claude-code'

import type { WorkBoard, WorkBoardFilter, WorkBoardItem } from '../types'
import { ancestorsOf, bandOf, bodyOf, filterItems, kstDay, parseBoard, projectKey } from './parse'

const BOARD = { plugin: 'work-board', key: 'board' } as const
const MEMORY = { plugin: 'work-board', key: 'memoryDir' } as const
const SELECTED = { plugin: 'work-board', key: 'selected' } as const
const DETAIL = { plugin: 'work-board', key: 'detail' } as const
const FILTER = { plugin: 'work-board', key: 'filter' } as const
const QUERY = { plugin: 'work-board', key: 'query' } as const
const ERROR = { plugin: 'work-board', key: 'error' } as const

const PANE_ID = 'work-board'
const AUTO_OPENED = 'autoOpenedDay'
const BANDS = ['오늘', '어제', '이번 주', '이번 달', '그 이전', '날짜 없음']

/** The one dim line under a card's title: what is left first, else the summary. */
export function hintOf(item: WorkBoardItem): string {
  if (item.remaining.length) return `남음 ${item.remaining.join(' / ')}`
  return item.summary
}

/** The items a filter shows: held ones only under `hold`, active ones otherwise. */
export function visibleItems(board: WorkBoard | null, filter: WorkBoardFilter, query: string): WorkBoardItem[] {
  if (!board) return []
  return filterItems(filter === 'hold' ? board.hold : board.active, filter, query)
}

/** Cards in their groups: recency bands on a ★ board, headings on any other. */
export function groupsOf(board: WorkBoard, items: WorkBoardItem[], nowMs: number): { name: string; items: WorkBoardItem[] }[] {
  const nameOf = (i: WorkBoardItem) => (board.mode === 'star' ? bandOf(i.date, nowMs) : i.section || '메모')
  const names = board.mode === 'star' ? BANDS : [...new Set(items.map(nameOf))]
  return names.map(name => ({ name, items: items.filter(i => nameOf(i) === name) })).filter(g => g.items.length)
}

/** The memory folder of the session's project: its directory or one above, or the main checkout of a worktree. */
async function findMemoryDir($: EngineInterface): Promise<string | null> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const cwd = await $.session.cwd()
  const roots = ancestorsOf(cwd)
  try {
    const git = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    const common = git.stdout.trim().replace(/\/\.git$/, '')
    if (git.exitCode === 0 && common && !roots.includes(common)) roots.splice(1, 0, common)
  } catch {
    // not a git checkout, or no git: the directories alone
  }
  for (const root of roots) {
    const dir = `${config}/projects/${projectKey(root)}/memory`
    if (await $.fs.exists(`${dir}/MEMORY.md`)) return dir
  }
  return null
}

async function load($: EngineInterface): Promise<void> {
  try {
    const dir = await findMemoryDir($)
    await $.state.set(MEMORY, dir)
    if (!dir) {
      await $.state.set(BOARD, null)
      await $.state.set(ERROR, null)
      return
    }
    await $.state.set(BOARD, parseBoard(await $.fs.read(`${dir}/MEMORY.md`)))
    await $.state.set(ERROR, null)
  } catch (err) {
    await $.state.set(ERROR, `MEMORY.md 를 읽지 못했습니다: ${String(err)}`)
  }
}

async function select($: EngineInterface, file: string | null): Promise<void> {
  await $.state.set(SELECTED, file)
  const dir = (await $.state.get(MEMORY)).value
  if (!file || !dir) {
    await $.state.set(DETAIL, null)
    return
  }
  try {
    await $.state.set(DETAIL, { file, text: bodyOf(await $.fs.read(`${dir}/${file}`)) })
  } catch {
    await $.state.set(DETAIL, { file, text: `_${file} 을 읽지 못했습니다._` })
  }
}

async function openPane($: EngineInterface): Promise<string> {
  await load($)
  const opened = await $.ui.open({ id: PANE_ID, title: '작업 보드' })
  return opened.isPlaced ? '작업 보드를 열었습니다.' : `작업 보드를 띄우지 못했습니다: ${opened.reason}`
}

/** The item before or after the open one, in the order the list shows. */
async function step($: EngineInterface, by: number): Promise<void> {
  const board = (await $.state.get(BOARD)).value
  const picked = (await $.state.get(SELECTED)).value
  const filter = (await $.state.get(FILTER)).value ?? 'all'
  const query = (await $.state.get(QUERY)).value ?? ''
  const now = await $.clock.now()
  const shown = board ? groupsOf(board, visibleItems(board, filter, query), now).flatMap(g => g.items) : []
  const at = shown.findIndex(i => i.id === picked)
  const next = shown[at + by]
  if (at >= 0 && next) await select($, next.id)
}

async function press($: EngineInterface, key: string): Promise<void> {
  if (key === 'refresh') {
    await load($)
    const picked = (await $.state.get(SELECTED)).value
    if (picked) await select($, picked)
  } else if (key === 'back') {
    await select($, null)
  } else if (key === 'prev' || key === 'next') {
    await step($, key === 'prev' ? -1 : 1)
  } else if (key === 'clear') {
    await $.state.set(QUERY, '')
    await $.state.set(FILTER, 'all')
  } else if (key.startsWith('filter:')) {
    const want = key.slice('filter:'.length) as WorkBoardFilter
    const now = (await $.state.get(FILTER)).value ?? 'all'
    await $.state.set(FILTER, want === now ? 'all' : want)
  } else if (key.startsWith('open:')) {
    await select($, key.slice('open:'.length))
  } else if (key.startsWith('edit:')) {
    const dir = (await $.state.get(MEMORY)).value
    if (!dir) return
    const path = `${dir}/${key.slice('edit:'.length)}`
    const code = await $.process.run(['/usr/bin/open', '-a', 'Visual Studio Code', path])
    if (code.exitCode === 0) return
    const text = await $.process.run(['/usr/bin/open', '-t', path])
    if (text.exitCode !== 0) $.ui.toast('편집기를 열지 못했습니다.')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'board', description: '작업 보드 열기 (MEMORY.md 의 작업 목록)', immediate: true })
    return started
  })

  // Shown unasked once a day: the first new session whose project has a memory, never a resume or a /clear.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'startup') return result
    const today = kstDay(await $.clock.now())
    if ((await $.store.get(AUTO_OPENED)) === today) return result
    await load($)
    const board = (await $.state.get(BOARD)).value
    if (!board || !board.active.length) return result
    await $.store.set(AUTO_OPENED, today)
    await $.ui.open({ id: PANE_ID, title: '작업 보드' })
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'board' }, async $ => ({ text: await openPane($) }))

  // Every control is answered here by its key, so a surface that drops onPress closures still works.
  on('ui.press', { requestId: PANE_ID }, async ($, e) => {
    await press($, e.element)
    return { element: e.element }
  })

  on('ui.input', { requestId: PANE_ID }, async ($, e) => {
    if (e.element === 'search') await $.state.set(QUERY, e.value)
    return { element: e.element, value: e.value }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Input = 'Input' in els ? els.Input : null
    const board = (await $.state.get(BOARD)).value
    const memoryDir = (await $.state.get(MEMORY)).value
    const error = (await $.state.get(ERROR)).value
    const picked = (await $.state.get(SELECTED)).value
    const detail = (await $.state.get(DETAIL)).value
    const filter = (await $.state.get(FILTER)).value ?? 'all'
    const query = (await $.state.get(QUERY)).value ?? ''
    const now = await $.clock.now()
    const isCompact = e.surface === 'terminal'
    const tap = (key: string) => () => void press($, key)

    const shown = visibleItems(board ?? null, filter, query)
    const groups = board ? groupsOf(board, shown, now) : []
    const order = groups.flatMap(g => g.items)
    const item = picked && board ? [...board.active, ...board.hold].find(i => i.id === picked) : undefined

    if (item) {
      const at = order.findIndex(i => i.id === item.id)
      const meta = [item.date, item.section].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Button key="back" label="← 목록" hotkey="b" onPress={tap('back')} />
            <Box flexDirection="row" gap={1}>
              {at > 0 ? <Button key="prev" label="‹ 이전" hotkey="p" dimColor onPress={tap('prev')} /> : null}
              {at >= 0 && at < order.length - 1 ? <Button key="next" label="다음 ›" hotkey="n" dimColor onPress={tap('next')} /> : null}
              <Button key={`edit:${item.file}`} label="편집기로 열기" dimColor onPress={tap(`edit:${item.file}`)} />
            </Box>
          </Box>

          <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
            {meta ? <Text dimColor>{meta}</Text> : null}
            <Text bold>{item.title}</Text>
            {item.summary ? <Text dimColor>{item.summary}</Text> : null}
          </Box>

          {item.remaining.length ? (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
              <Text bold color="warning">{`남은 조치 ${item.remaining.length}`}</Text>
              {item.remaining.map((r, n) => <Text key={`rem-${n}`}>{`☐ ${r}`}</Text>)}
            </Box>
          ) : null}

          {item.cautions.length ? (
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
              <Text bold color="error">{`주의 ${item.cautions.length}`}</Text>
              {item.cautions.map((c, n) => <Text key={`cau-${n}`}>{`● ${c}`}</Text>)}
            </Box>
          ) : null}

          <Box flexDirection="column">
            <Text bold dimColor>메모 본문</Text>
            {detail?.file === item.file ? <Markdown key="body" text={detail.text} /> : <Text dimColor>불러오는 중…</Text>}
          </Box>
        </Box>
      )
    }

    const active = board?.active ?? []
    const counts: { key: WorkBoardFilter; label: string; n: number }[] = [
      { key: 'all', label: '전체', n: active.length },
      { key: 'left', label: '남은 조치', n: active.filter(i => i.remaining.length).length },
      { key: 'caution', label: '주의', n: active.filter(i => i.cautions.length).length },
      ...(board?.hold.length ? [{ key: 'hold' as const, label: '보류', n: board.hold.length }] : []),
    ]

    const card = (i: WorkBoardItem) => {
      const hint = hintOf(i)
      const marks = (
        <Box flexDirection="row" gap={1}>
          {i.remaining.length ? <Text color="warning">{`▸ 남음 ${i.remaining.length}`}</Text> : null}
          {i.cautions.length ? <Text color="error">{`● 주의 ${i.cautions.length}`}</Text> : null}
          {hint ? <Text dimColor wrap="truncate-end">{hint}</Text> : null}
        </Box>
      )
      const title = (
        <Box flexDirection="row">
          {i.date ? <Text dimColor>{`${i.date}  `}</Text> : null}
          <Button key={`open:${i.id}`} label={i.title} plain onPress={tap(`open:${i.id}`)} />
        </Box>
      )
      if (isCompact) {
        return (
          <Box key={`card:${i.id}`} flexDirection="column">
            {title}
            <Box paddingLeft={2}>{marks}</Box>
          </Box>
        )
      }
      return (
        <Box
          key={`card:${i.id}`}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          paddingX={1}
          hover={{ borderColor: 'suggestion', borderDimColor: false }}
        >
          {title}
          {marks}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {counts.map(c => (
              <Button
                key={`filter:${c.key}`}
                label={`${c.label} ${c.n}`}
                variant={filter === c.key ? 'primary' : undefined}
                dimColor={filter !== c.key}
                onPress={tap(`filter:${c.key}`)}
              />
            ))}
          </Box>
          <Button key="refresh" label="새로고침" hotkey="r" dimColor onPress={tap('refresh')} />
        </Box>

        {board ? (
          <Box flexDirection="row" gap={1} alignItems="center">
            {Input ? (
              <Box flexGrow={1}>
                <Input key="search" placeholder="제목·남은 조치·주의 검색" value={query} submitLabel="검색" onInput={() => {}} onSubmit={() => {}} />
              </Box>
            ) : null}
            {query || filter !== 'all' ? <Button key="clear" label="조건 지우기" dimColor onPress={tap('clear')} /> : null}
          </Box>
        ) : null}

        {error ? <Text color="error">{error}</Text> : null}

        {!memoryDir && !error ? (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Text bold>이 프로젝트에는 아직 메모가 없습니다.</Text>
            <Text dimColor>Claude Code 자동 메모리(MEMORY.md)가 쌓이면 여기에 목록으로 보입니다.</Text>
          </Box>
        ) : null}

        {board && !order.length ? (
          <Text dimColor>{query || filter !== 'all' ? '조건에 맞는 작업이 없습니다.' : '표시할 작업이 없습니다.'}</Text>
        ) : null}

        {groups.map(g => (
          <Box key={`group:${g.name}`} flexDirection="column" gap={isCompact ? 0 : 1}>
            <Text bold dimColor>{`${g.name}  ${g.items.length}`}</Text>
            {g.items.map(card)}
          </Box>
        ))}
      </Box>
    )
  })
}
