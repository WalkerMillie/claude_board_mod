import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { ancestorsOf, bandOf, bodyOf, fileDate, filterItems, headingOf, kstDay, parseBoard, projectKey } from './parse'
import { groupsOf, hintOf, visibleItems } from './register'

const STAR_INDEX = [
  '# Memory',
  '## 🔴 소통 방식',
  '- [★응답은 항상 한국어](feedback_korean.md)',
  '## 활성 작업',
  '- [★10-13 연동 규약 문서화 — 5페이지 게시 · 남음=수정 항목 재검증 · 🔴정본=develop](a.md)',
  '- [10-13 답변칸 개편 — FE 머지](done.md)',
  '- [**★10-08 운영 모니터링** — BE 머지 · 남음=manifest 푸시·Sync·🔴봇 미확인 · 🔴알림 봇 이름 미확인](b.md) · [곁가지](side.md)',
  '- [★QA 레인 감사 — BE 정리](project_qa_20260901.md)',
  '## 보류·미착수 (★)',
  '- [3건 판정 — 공급가](d.md) · [정책 충돌 7건](e.md)',
  '## 작업 수칙 (feedback)',
  '- [★아님](f.md)',
].join('\n')

const PLAIN_INDEX = [
  '- [Build commands](reference_build.md) — how to run the app locally',
  '## Preferences',
  '- [Short answers](feedback_short.md) — keep replies brief',
  '- [Release train 20261010](project_release_20261010.md) — 남음=QA sign-off',
].join('\n')

const NOW = Date.UTC(2026, 9, 13, 3, 0)

test('a ★ index shows only ★ active items and every held link, newest first', () => {
  const board = parseBoard(STAR_INDEX)
  expect(board.mode).toBe('star')
  expect(board.active.map(i => i.file)).toEqual(['a.md', 'b.md', 'project_qa_20260901.md'])
  expect(board.hold.map(i => i.file)).toEqual(['d.md', 'e.md'])
})

test('a line splits into date, title, remaining and cautions', () => {
  const [a, b, c] = parseBoard(STAR_INDEX).active
  if (!a || !b || !c) throw new Error('three active items expected')
  expect(a.date).toBe('10-13')
  expect(a.title).toBe('연동 규약 문서화')
  expect(a.section).toBe('활성 작업')
  expect(a.remaining).toEqual(['수정 항목 재검증'])
  expect(a.cautions).toEqual(['정본=develop'])
  expect(a.summary).toBe('5페이지 게시')
  expect(b.title).toBe('운영 모니터링')
  expect(b.remaining).toEqual(['manifest 푸시·Sync'])
  expect(b.cautions).toEqual(['알림 봇 이름 미확인', '봇 미확인'])
  expect(c.date).toBe('09-01')
  expect(hintOf(c)).toBe('BE 정리')
})

test('any other index lists every linked line under its heading', () => {
  const board = parseBoard(PLAIN_INDEX)
  expect(board.mode).toBe('all')
  expect(board.active.map(i => [i.title, i.section, i.summary])).toEqual([
    ['Build commands', '', 'how to run the app locally'],
    ['Short answers', 'Preferences', 'keep replies brief'],
    ['Release train 20261010', 'Preferences', ''],
  ])
  expect(board.active[2]?.remaining).toEqual(['QA sign-off'])
  expect(groupsOf(board, board.active, NOW).map(g => [g.name, g.items.length])).toEqual([
    ['메모', 1],
    ['Preferences', 2],
  ])
})

test('filters, search and recency groups', () => {
  const board = parseBoard(STAR_INDEX)
  expect(visibleItems(board, 'left', '').map(i => i.file)).toEqual(['a.md', 'b.md'])
  expect(visibleItems(board, 'caution', '봇').map(i => i.file)).toEqual(['b.md'])
  expect(visibleItems(board, 'hold', '').map(i => i.file)).toEqual(['d.md', 'e.md'])
  expect(filterItems(board.active, 'all', 'DEVELOP').map(i => i.file)).toEqual(['a.md'])
  expect(groupsOf(board, board.active, NOW).map(g => [g.name, g.items.length])).toEqual([
    ['오늘', 1],
    ['이번 주', 1],
    ['그 이전', 1],
  ])
  expect(bandOf('12-31', NOW)).toBe('그 이전')
  expect(bandOf('10-12', NOW)).toBe('어제')
  expect(bandOf(null, NOW)).toBe('날짜 없음')
})

test('paths, headings, frontmatter and KST days', () => {
  expect(projectKey('/Users/a/My.Projects/app')).toBe('-Users-a-My-Projects-app')
  expect(ancestorsOf('/Users/a/app/')).toEqual(['/Users/a/app', '/Users/a', '/Users'])
  expect(headingOf('## 보류·미착수 (★)')).toBe('보류·미착수')
  expect(headingOf('## 🔴 소통 방식')).toBe('소통 방식')
  expect(fileDate('project_x_20261013.md')).toBe('10-13')
  expect(fileDate('reference_build.md')).toBe(null)
  expect(bodyOf('---\nname: x\n---\n\n본문')).toBe('본문')
  expect(kstDay(Date.UTC(2026, 9, 13, 15, 30))).toBe('2026-10-14')
})

const HOME = '/Users/me'
const CWD = '/Users/me/code/app'
const MEM = `${HOME}/.claude/projects/-Users-me-code-app/memory`
const FILES: Record<string, string> = {
  [`${MEM}/MEMORY.md`]: STAR_INDEX,
  [`${MEM}/b.md`]: '---\nname: b\n---\n\n# 운영 모니터링 본문',
}
const PANE_PROPS = { title: '작업 보드', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 40, offset: 0 }, view: {} }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: /board finds the memory, filters, searches and opens a card`, async ($, on) => {
    const ran: string[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'board' } }))
    on('clock.now', () => ({ value: NOW }))
    on('session.cwd', () => ({ value: CWD }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
    on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
    on('fs.read', (_$, e) => {
      const text = FILES[e.path]
      if (text === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: text }
    })
    on('process.run', (_$, e) => {
      ran.push(e.argv.join(' '))
      return { value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))

    await $.session.start({ cwd: CWD, surface, isInteractive: true })
    const run = await $.command.run({ command: 'board', args: '', origin: { kind: 'composer' } } as never)
    expect(JSON.stringify(run)).toContain('작업 보드를 열었습니다.')

    const pane = (await $.ui.mount({ plugin: 'work-board', surface, component: 'Pane', requestId: 'work-board', props: PANE_PROPS } as never)) as Mounted<'desktop', 'Pane'>
    expect(await pane.find({ key: 'filter:all', text: '전체 3' })).toBeDefined()
    expect(await pane.find({ key: 'filter:hold', text: '보류 2' })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /^오늘/ })).length).toBe(1)
    expect(await pane.find({ key: 'open:a.md' })).toBeDefined()

    await pane.press({ key: 'filter:caution' })
    await pane.input({ key: 'search', text: '봇', kind: 'change' })
    expect(await pane.find({ key: 'open:a.md' })).toBeUndefined()
    expect(await pane.find({ key: 'open:b.md' })).toBeDefined()

    await pane.press({ key: 'open:b.md' })
    expect(await pane.find({ key: 'back' })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: '남은 조치 1' })).length).toBe(1)
    expect((await pane.findAll({ type: 'Text', text: '주의 2' })).length).toBe(1)
    expect(JSON.stringify(await pane.drawn())).toContain('운영 모니터링 본문')

    await pane.press({ key: 'edit:b.md' })
    expect(ran).toContain(`/usr/bin/open -a Visual Studio Code ${MEM}/b.md`)
    expect(ran).toContain(`/usr/bin/open -t ${MEM}/b.md`)

    await pane.press({ key: 'back' })
    await pane.press({ key: 'clear' })
    expect(await pane.find({ key: 'open:a.md' })).toBeDefined()
  })
}

test('a project without a memory says so instead of failing', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'board' } }))
  on('clock.now', () => ({ value: NOW }))
  on('session.cwd', () => ({ value: '/tmp/empty' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp/empty', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'board', args: '', origin: { kind: 'composer' } } as never)
  const pane = await $.ui.mount({ plugin: 'work-board', surface: 'desktop', component: 'Pane', requestId: 'work-board', props: PANE_PROPS } as never)
  expect((await pane.findAll({ type: 'Text', text: '이 프로젝트에는 아직 메모가 없습니다.' })).length).toBe(1)
})
