/**
 * 独棋（Chess Ranger / Solo Chess）—— 游戏专用类型与常量
 *
 * 规则（puzzle-chess.com 同款）：
 *   - 棋子按标准国际象棋规则移动；
 *   - 每一步都必须是「吃子」，不能走空步；
 *   - 允许吃王（没有将军/将死/王车易位等限制）；
 *   - 目标：经过若干步后，盘面上只剩一个棋子。
 *
 * 简化约定（本实现）：
 *   - 全部棋子统一为同一方（白方），因此兵只朝上（行号减小的方向）斜吃；
 *   - 兵不升变（本游戏只有吃子，升变没有意义）；
 *   - 棋盘矩形，宽度 3..10、高度 3..8（内置题最大 8×8）。
 *
 * 格子值编码（0 = 空格）：
 *   1=兵 2=马 3=象 4=车 5=后 6=王
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

/* ────────────────────────── 棋子编码 ────────────────────────── */

export const EMPTY = 0
export const PAWN = 1
export const KNIGHT = 2
export const BISHOP = 3
export const ROOK = 4
export const QUEEN = 5
export const KING = 6

/** 全部棋子类型（1..6） */
export const PIECE_TYPES = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING] as const

/** 中文名（状态栏 / 回放说明用） */
export const PIECE_NAMES: Record<number, string> = {
  [PAWN]: '兵',
  [KNIGHT]: '马',
  [BISHOP]: '象',
  [ROOK]: '车',
  [QUEEN]: '后',
  [KING]: '王',
}

/** 单字符记号（日志 / 编码用） */
export const PIECE_LETTERS: Record<number, string> = {
  [PAWN]: 'P',
  [KNIGHT]: 'N',
  [BISHOP]: 'B',
  [ROOK]: 'R',
  [QUEEN]: 'Q',
  [KING]: 'K',
}

/**
 * 棋盘上绘制的字形。统一使用实心国际象棋字形，
 * 用描边/阴影保证在深浅底色上都清晰。
 */
export const PIECE_GLYPHS: Record<number, string> = {
  [PAWN]: '♟',
  [KNIGHT]: '♞',
  [BISHOP]: '♝',
  [ROOK]: '♜',
  [QUEEN]: '♛',
  [KING]: '♚',
}

export function isPiece(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= PAWN && v <= KING
}

export function pieceName(v: number): string {
  return PIECE_NAMES[v] ?? '棋'
}

export function pieceGlyph(v: number): string {
  return PIECE_GLYPHS[v] ?? ''
}

/* ────────────────────────── 题面 / 状态 ────────────────────────── */

/** 题面：layout 长度为 width*height，0=空、1..6=棋子 */
export interface ChessPuzzle extends Puzzle {
  layout: number[]
  /** 参考解（吃子序列），内置题由生成器写入；自定义题没有 */
  solution?: CaptureStep[]
}

/** 一次吃子：攻击方 origin 吃掉 target，落到 target */
export interface CaptureStep {
  origin: number
  target: number
  /** 攻击方棋子类型 */
  piece: number
  /** 被吃掉的棋子类型 */
  captured: number
}

/** 一条历史记录（与 CaptureStep 相同） */
export type CaptureLog = CaptureStep

/** 棋盘状态 */
export interface ChessState extends GameState {
  /** 当前盘面（0 空，1..6 棋子） */
  board: number[]
  /** 题面初始布局（校验/清空都是回到它） */
  initial: number[]
  /** 已完成的吃子记录（从小到大，用于逐步合法性校验） */
  history: CaptureLog[]
  /** 当前选中的棋子索引；-1 = 未选中 */
  selected: number
  /** 键盘光标索引；-1 = 不显示 */
  cursor: number
  /** 最近一次非法尝试（用于红色高亮） */
  invalid: { origin: number; target: number } | null
  /** 最近一步（用于落点高亮） */
  lastMove: { origin: number; target: number } | null
}

/** 校验结果 */
export interface ChessResult extends ValidationResult {
  /** 剩余棋子数 */
  pieces: number
  /** 题面初始棋子数 */
  initialPieces: number
  /** 已吃子步数 */
  captures: number
  /** 当前盘面可用的吃子走法数 */
  legal: number
  /** 校验历史是否合法（每步都是合法吃子） */
  historyOk: boolean
  /** 棋盘是否已无子可吃（且还没通关） */
  stuck: boolean
  /** 历史校验错误说明 */
  issues: string[]
}

/* ────────────────────────── 编码工具 ────────────────────────── */

/** 把 layout 编码成数字串（每格 1 个字符） */
export function encodeLayout(layout: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < layout.length; i++) out += String(layout[i] | 0)
  return out
}

/** 解码 layout；长度不符或出现非法值返回 null */
export function decodeLayout(text: unknown, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected).fill(0)
  for (let i = 0; i < expected; i++) {
    const code = text.charCodeAt(i) - 48
    if (code < 0 || code > KING) return null
    out[i] = code
  }
  return out
}

/** 把吃子序列编码成 "from-to;from-to"（0 基索引，便于脚本生成/审计） */
export function encodeSteps(steps: ArrayLike<CaptureStep>): string {
  const parts: string[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    parts.push(`${s.origin}-${s.target}`)
  }
  return parts.join(';')
}

/** 解析 "from-to;from-to"；格式非法返回 null（不校验走法合法性） */
export function decodeSteps(text: unknown): Array<{ origin: number; target: number }> | null {
  if (typeof text !== 'string') return null
  if (text.trim() === '') return []
  const parts = text.split(';')
  const out: Array<{ origin: number; target: number }> = []
  for (const part of parts) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim())
    if (!m) return null
    const origin = Number(m[1])
    const target = Number(m[2])
    if (!Number.isInteger(origin) || !Number.isInteger(target)) return null
    out.push({ origin, target })
  }
  return out
}

/** 坐标显示：a1 在左下角（列字母 + 从下往上的行号） */
export function coordOf(index: number, width: number, height: number): string {
  const x = index % width
  const y = Math.floor(index / width)
  const file = 'abcdefghij'[x] ?? '?'
  return `${file}${height - y}`
}

/** 把步骤转成可读说明，如「马 b1→c3 吃兵」 */
export function stepText(step: CaptureStep, width: number, height: number): string {
  return `${pieceName(step.piece)} ${coordOf(step.origin, width, height)}→${coordOf(
    step.target,
    width,
    height,
  )} 吃${pieceName(step.captured)}`
}

/* ────────────────────────── 类型收窄 ────────────────────────── */

export function asChessPuzzle(p: Puzzle): ChessPuzzle {
  return p as ChessPuzzle
}

export function asChessState(s: GameState): ChessState {
  return s as ChessState
}
