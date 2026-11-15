/**
 * 独棋 —— 状态与落子（撤销 / 存档 / 选择）
 *
 * 普通吃子走法用 core 的 Move 表示：
 *   index  = 目标格
 *   from   = 起点 + 1（非 0，模板约定 0 = 未定）
 *   to     = 目标 + 1
 *   meta   = { kind:'capture'|'uncapture', origin, target, piece, captured }
 *
 * 这样 core 的撤销/重做、逻辑回放、提示直接可用；选中/取消选中只是状态变化，
 * 不进入撤销栈（由 adapter.clickAt / keyAt 直接改 state）。
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import { asChessPuzzle, isPiece, type CaptureLog, type CaptureStep, type ChessPuzzle, type ChessState } from './types.ts'

/** Move.meta 的形状 */
export interface CaptureMeta {
  kind: 'capture' | 'uncapture'
  origin: number
  target: number
  piece: number
  captured: number
}

/** 一步合法吃子 → 可撤销/可回放的 Move */
export function makeCaptureMove(step: CaptureStep): Move {
  return {
    index: step.target,
    from: step.origin + 1,
    to: step.target + 1,
    meta: {
      kind: 'capture',
      origin: step.origin,
      target: step.target,
      piece: step.piece,
      captured: step.captured,
    },
  }
}

/** 读取 move 的 meta（不是独棋的吃子则返回 null） */
export function captureMetaOf(move: Move): CaptureMeta | null {
  const meta = move.meta
  if (!meta) return null
  if (meta.kind !== 'capture' && meta.kind !== 'uncapture') return null
  const { origin, target, piece, captured } = meta
  if (
    typeof origin !== 'number' ||
    typeof target !== 'number' ||
    typeof piece !== 'number' ||
    typeof captured !== 'number'
  ) {
    return null
  }
  return { kind: meta.kind, origin, target, piece, captured }
}

/** 题面初始布局（非法时退化为空盘） */
function layoutOf(puzzle: Puzzle): number[] {
  const p = asChessPuzzle(puzzle)
  const size = Math.max(0, p.width * p.height)
  const layout = Array.isArray(p.layout) ? p.layout : []
  const out = new Array<number>(size).fill(0)
  for (let i = 0; i < size && i < layout.length; i++) {
    const v = layout[i] | 0
    out[i] = isPiece(v) ? v : 0
  }
  return out
}

export function createEmptyState(puzzle: Puzzle): ChessState {
  const initial = layoutOf(puzzle)
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    board: initial.slice(),
    initial: initial.slice(),
    history: [],
    selected: -1,
    cursor: -1,
    invalid: null,
    lastMove: null,
  }
}

export function cloneState(state: GameState): ChessState {
  const s = state as ChessState
  return {
    ...s,
    board: s.board.slice(),
    initial: s.initial.slice(),
    history: s.history.map((h) => ({ ...h })),
    invalid: s.invalid ? { ...s.invalid } : null,
    lastMove: s.lastMove ? { ...s.lastMove } : null,
  }
}

/** 左键循环值（本项目走 clickAt，这里保留给模板兜底/自定义编辑器之外的情况） */
export function cycleValue(state: GameState, target: HitTarget): number {
  const s = state as ChessState
  const i = target.index
  if (i < 0 || i >= s.board.length) return 0
  const cur = s.board[i] | 0
  if (cur <= 0) return 1
  if (cur >= 6) return 0
  return cur + 1
}

/** 右键直接清空格（本项目走 clickAt 取消选中，这里保留兜底） */
export function rightClickValue(_state: GameState, _target: HitTarget): number {
  return 0
}

export function valueAt(state: GameState, index: number): number {
  const s = state as ChessState
  if (index < 0 || index >= s.board.length) return 0
  return s.board[index] | 0
}

/**
 * 把一步吃子写入状态（forward）或撤销一步吃子（inverse）。
 * 只处理带 meta 的独棋吃子；其它 move 直接忽略。
 */
export function applyMove(state: GameState, move: Move): void {
  const s = state as ChessState
  const meta = captureMetaOf(move)
  if (!meta) return
  const { origin, target, piece, captured } = meta
  if (
    origin < 0 ||
    target < 0 ||
    origin >= s.board.length ||
    target >= s.board.length
  ) {
    return
  }

  if (meta.kind === 'capture') {
    s.board[target] = piece
    s.board[origin] = 0
    s.history.push({ origin, target, piece, captured })
    s.lastMove = { origin, target }
  } else {
    s.board[origin] = piece
    s.board[target] = captured
    const last = s.history[s.history.length - 1]
    if (
      last &&
      last.origin === origin &&
      last.target === target &&
      last.piece === piece &&
      last.captured === captured
    ) {
      s.history.pop()
    }
    const prev = s.history[s.history.length - 1]
    s.lastMove = prev ? { origin: prev.origin, target: prev.target } : null
  }
  s.selected = -1
  s.cursor = -1
  s.invalid = null
}

export function invertMove(move: Move): Move {
  const meta = captureMetaOf(move)
  if (!meta) return { ...move, from: move.to, to: move.from }
  const kind = meta.kind === 'capture' ? 'uncapture' : 'capture'
  return {
    index: meta.origin,
    from: meta.target + 1,
    to: meta.origin + 1,
    meta: { ...meta, kind },
  }
}

/* ────────────────────────── 存档 ────────────────────────── */

interface SerializedChess {
  version: number
  puzzleId: string
  width: number
  height: number
  board: number[]
  initial: number[]
  history: Array<[number, number, number, number]>
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = state as ChessState
  const data: SerializedChess = {
    version: 2,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    board: s.board.slice(),
    initial: s.initial.slice(),
    history: s.history.map((h) => [h.origin, h.target, h.piece, h.captured]),
  }
  return data as unknown as Record<string, unknown>
}

export function deserializeState(data: Record<string, unknown>): ChessState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width | 0
  const h = data.height | 0
  if (w <= 0 || h <= 0 || w > 20 || h > 20) return null
  const size = w * h

  const readBoard = (raw: unknown): number[] | null => {
    if (!Array.isArray(raw) || raw.length !== size) return null
    const out = new Array<number>(size).fill(0)
    for (let i = 0; i < size; i++) {
      const v = Number(raw[i])
      if (!Number.isInteger(v) || v < 0 || v > 6) return null
      out[i] = v
    }
    return out
  }

  const board = readBoard(data.board)
  if (!board) return null
  const initial = readBoard(data.initial) ?? board.slice()

  const history: CaptureLog[] = []
  if (Array.isArray(data.history)) {
    for (const item of data.history) {
      if (!Array.isArray(item) || item.length !== 4) return null
      const origin = Number(item[0])
      const target = Number(item[1])
      const piece = Number(item[2])
      const captured = Number(item[3])
      if (
        !Number.isInteger(origin) ||
        !Number.isInteger(target) ||
        !Number.isInteger(piece) ||
        !Number.isInteger(captured)
      ) {
        return null
      }
      if (!isPiece(piece) || !isPiece(captured)) return null
      if (origin < 0 || origin >= size || target < 0 || target >= size) return null
      history.push({ origin, target, piece, captured })
    }
  }

  const last = history[history.length - 1]
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    board,
    initial,
    history,
    selected: -1,
    cursor: -1,
    invalid: null,
    lastMove: last ? { origin: last.origin, target: last.target } : null,
  }
}

/** 用「题面 + 吃子序列」构造完整状态（参考解 / 逻辑回放 / 求解结果都用） */
export function stateFromSteps(
  puzzle: ChessPuzzle,
  steps: CaptureStep[],
  extraHistory: CaptureLog[] = [],
): ChessState {
  const state = createEmptyState(puzzle)
  for (const log of extraHistory) {
    state.board[log.target] = log.piece
    state.board[log.origin] = 0
    state.history.push({ ...log })
  }
  for (const step of steps) {
    state.board[step.target] = step.piece
    state.board[step.origin] = 0
    state.history.push({ ...step })
  }
  const last = state.history[state.history.length - 1]
  state.lastMove = last ? { origin: last.origin, target: last.target } : null
  return state
}
