/**
 * 独棋 —— 交互（鼠标点选 / 键盘光标）
 *
 * 交互模型：
 *   - 左键点一枚棋子 → 选中（高亮显示所有可吃目标）；
 *   - 再点一个可吃目标 → 执行吃子；
 *   - 再点另一枚棋子 → 改选；点子 / 空目标 → 状态栏给出非法走法提示；
 *   - 右键 / Esc → 取消选中；
 *   - 方向键移动键盘光标；回车：选中 / 吃子 / 取消；Esc 取消。
 */

import type { HitTarget, InteractionResult } from '../core/types'
import { canCapture, countPieces, legalTargets } from './rules.ts'
import { captureMetaOf, makeCaptureMove } from './state.ts'
import {
  coordOf,
  isPiece,
  pieceGlyph,
  pieceName,
  type ChessState,
} from './types.ts'

function ok(changed: boolean, message = '', flash = false): InteractionResult {
  return { changed, message, tone: changed ? 'ok' : '', flash }
}

function bad(changed: boolean, message: string): InteractionResult {
  return { changed, message, tone: 'bad' }
}

function clearSelection(s: ChessState): void {
  s.selected = -1
  s.cursor = -1
  s.invalid = null
}

function firstPieceIndex(s: ChessState): number {
  for (let i = 0; i < s.board.length; i++) if (isPiece(s.board[i])) return i
  return -1
}

/** 选中某枚棋子 */
function selectPiece(s: ChessState, index: number, note = ''): InteractionResult {
  s.selected = index
  s.cursor = index
  s.invalid = null
  const name = pieceName(s.board[index] ?? 0)
  return ok(true, note || `已选中 ${pieceGlyph(s.board[index] ?? 0)} ${name}，点击高亮目标吃子。`)
}

/** 尝试执行一次吃子 */
function tryCapture(s: ChessState, origin: number, target: number): InteractionResult {
  const piece = s.board[origin] | 0
  const captured = s.board[target] | 0
  if (!isPiece(piece) || !isPiece(captured) || !canCapture(s.board, s.width, s.height, origin, target)) {
    s.invalid = { origin, target }
    return bad(
      true,
      `非法走法：${pieceName(piece)}不能这样吃${captured ? pieceName(captured) : '空格'}（每步必须按标准走法吃子）。`,
    )
  }
  const step = { origin, target, piece, captured }
  const move = makeCaptureMove(step)
  // 与 core applyMove 一致：先写盘面/历史，再由 core 记录撤销
  s.board[target] = piece
  s.board[origin] = 0
  s.history.push(step)
  s.lastMove = { origin, target }
  s.selected = -1
  s.cursor = -1
  s.invalid = null
  const remain = countPieces(s.board)
  const done = remain === 1
  return {
    changed: true,
    move,
    message: done
      ? `吃子成功：${pieceName(piece)} ${coordOf(origin, s.width, s.height)}×${coordOf(
          target,
          s.width,
          s.height,
        )}，盘面只剩 1 枚棋子 —— 完成！`
      : `吃子成功：${pieceName(piece)} ${coordOf(origin, s.width, s.height)}×${coordOf(
          target,
          s.width,
          s.height,
        )}，剩余 ${remain} 枚。`,
    tone: done ? 'ok' : '',
    flash: true,
  }
}

/** 鼠标点击（button: 0 左键，2 右键） */
export function handleClick(s: ChessState, target: HitTarget, button: 0 | 2): InteractionResult {
  const i = target.index
  if (!Number.isInteger(i) || i < 0 || i >= s.board.length) {
    return { changed: false, message: '点在棋盘外了。', tone: 'bad' }
  }
  if (button === 2) {
    if (s.selected < 0 && s.cursor < 0 && !s.invalid) {
      return { changed: false, message: '当前没有选中的棋子。' }
    }
    clearSelection(s)
    return ok(true, '已取消选中。')
  }

  const piece = s.board[i] | 0

  // 没有选中：点棋子就选中，点空格提示
  if (s.selected < 0) {
    if (!isPiece(piece)) {
      return { changed: false, message: '这是空格：先点一枚棋子选中它。', tone: 'bad' }
    }
    return selectPiece(s, i)
  }

  // 再点同一枚：取消
  if (s.selected === i) {
    clearSelection(s)
    return ok(true, '已取消选中。')
  }

  if (isPiece(piece)) {
    if (canCapture(s.board, s.width, s.height, s.selected, i)) {
      return tryCapture(s, s.selected, i)
    }
    // 不是可吃目标 —— 改选这枚棋子，并提示上一步不可吃
    const prev = s.selected
    s.selected = i
    s.cursor = i
    s.invalid = { origin: prev, target: i }
    return bad(
      true,
      `这枚棋子吃不到 ${coordOf(i, s.width, s.height)}，已改选 ${pieceGlyph(piece)} ${pieceName(piece)}。`,
    )
  }

  // 点空格：非法（不能走空步）
  s.invalid = { origin: s.selected, target: i }
  return bad(
    true,
    `非法走法：不能走到空格 ${coordOf(i, s.width, s.height)} —— 每一步都必须吃子。`,
  )
}

/** 键盘光标移动后的提示 */
function cursorNote(s: ChessState, index: number): string {
  const piece = s.board[index] | 0
  const where = coordOf(index, s.width, s.height)
  if (!isPiece(piece)) {
    return `光标 ${where}（空格）。`
  }
  const selected =
    s.selected >= 0
      ? ` · 已选 ${pieceName(s.board[s.selected] ?? 0)}@${coordOf(s.selected, s.width, s.height)}`
      : ''
  return `光标 ${where}：${pieceGlyph(piece)} ${pieceName(piece)}${selected}。`
}

/** 键盘交互：方向键、回车/空格、Esc */
export function handleKey(s: ChessState, key: string): InteractionResult | null {
  const width = s.width
  const height = s.height

  if (key === 'Escape') {
    const had = s.selected >= 0 || s.cursor >= 0 || !!s.invalid
    clearSelection(s)
    return { changed: had, message: had ? '已取消选中。' : '没有可取消的选择。' }
  }

  const dirs: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  if (key in dirs) {
    const [dx, dy] = dirs[key]!
    let cur = s.cursor
    if (cur < 0) cur = s.selected >= 0 ? s.selected : firstPieceIndex(s)
    if (cur < 0) {
      return { changed: false, message: '盘面上没有棋子。', tone: 'bad' }
    }
    const x = cur % width
    const y = Math.floor(cur / width)
    const nx = Math.max(0, Math.min(width - 1, x + dx))
    const ny = Math.max(0, Math.min(height - 1, y + dy))
    const next = ny * width + nx
    s.cursor = next
    s.invalid = null
    return { changed: next !== cur, message: cursorNote(s, next) }
  }

  if (key === 'Enter' || key === ' ') {
    let cur = s.cursor
    if (cur < 0) {
      cur = s.selected >= 0 ? s.selected : firstPieceIndex(s)
    }
    if (cur < 0) {
      return { changed: false, message: '盘面上没有棋子。', tone: 'bad' }
    }
    s.cursor = cur
    if (s.selected >= 0 && s.selected !== cur) {
      if (isPiece(s.board[cur]) && canCapture(s.board, width, height, s.selected, cur)) {
        return tryCapture(s, s.selected, cur)
      }
      if (isPiece(s.board[cur])) {
        return selectPiece(s, cur, `已改选 ${pieceName(s.board[cur] ?? 0)}。`)
      }
      s.invalid = { origin: s.selected, target: cur }
      return bad(true, '非法走法：光标处是空格，每一步都必须吃子。')
    }
    if (s.selected === cur) {
      clearSelection(s)
      return ok(true, '已取消选中。')
    }
    if (isPiece(s.board[cur])) return selectPiece(s, cur)
    return { changed: false, message: '光标处是空格：请移到棋子或先点选一枚棋子。', tone: 'bad' }
  }

  return null
}

/** 当前选中棋子的全部合法目标（渲染高亮用） */
export function selectedTargets(s: ChessState): number[] {
  if (s.selected < 0 || !isPiece(s.board[s.selected])) return []
  return legalTargets(s.board, s.width, s.height, s.selected)
}

/** 一步 Move 是否是吃子（供核心/调试） */
export function isCaptureMove(move: unknown): boolean {
  if (!move || typeof move !== 'object') return false
  return captureMetaOf(move as Parameters<typeof captureMetaOf>[0]) !== null
}
