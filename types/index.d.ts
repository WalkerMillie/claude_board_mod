export type WorkBoardItem = {
  /** The topic file name, unique per item. */
  id: string
  file: string
  group: 'active' | 'hold'
  /** The `## ` heading the line sits under, emoji and ★ stripped. */
  section: string
  /** MM-DD from the index line, else from a YYYYMMDD in the file name. */
  date: string | null
  title: string
  summary: string
  /** Each `남음=…` of the line. */
  remaining: string[]
  /** Each `🔴…` part of the line. */
  cautions: string[]
  isStar: boolean
  /** Why a tidy candidate is one: done-looking, untouched for long, or no file. */
  reason?: string
}

/**
 * `star`: the index has 활성 작업 / 보류·미착수 sections and only ★ lines show.
 * `all`: any other MEMORY.md; every linked line shows, grouped by its heading.
 */
export type WorkBoard = {
  mode: 'star' | 'all'
  active: WorkBoardItem[]
  hold: WorkBoardItem[]
  /** Lines worth a tidy, each with its reason; empty until the folder is listed. */
  tidy: WorkBoardItem[]
}

export type WorkBoardDetail = { file: string; text: string }

export type WorkBoardFilter = 'all' | 'left' | 'caution' | 'hold' | 'tidy'

declare module 'claude-code' {
  interface PluginState {
    'work-board': {
      board: WorkBoard | null
      /** The memory folder MEMORY.md was read from, found from the session's directory. */
      memoryDir: string | null
      selected: string | null
      detail: WorkBoardDetail | null
      filter: WorkBoardFilter
      query: string
      /** The tidy button was pressed once; the next press sends the request. */
      armed: boolean
      error: string | null
    }
  }
}
