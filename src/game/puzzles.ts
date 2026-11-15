/**
 * 独棋 —— 题库加载与参考解
 *
 * puzzles-data.ts 由 scripts/gen-puzzles.mjs 生成：
 *   board    : width*height 个数字字符（0 空，1..6 棋子）
 *   solution : 吃子序列 "origin-target;origin-target"（0 基索引）
 *
 * 本文件是纯 TS（不依赖 DOM），scripts/check.mjs 直接导入做题库审计。
 */

import type { GameState, Puzzle } from '../core/types'
import { canCapture } from './rules.ts'
import {
  KING,
  asChessPuzzle,
  decodeLayout,
  decodeSteps,
  encodeLayout,
  encodeSteps,
  isPiece,
  type CaptureStep,
  type ChessPuzzle,
} from './types.ts'
import { stateFromSteps } from './state.ts'
import { RAW_PUZZLES } from './puzzles-data.ts'

export type { RawPuzzle } from './puzzles-data.ts'

/** 一步吃子在当前盘面上是否合法 */
export function stepIsLegal(board: number[], width: number, height: number, step: CaptureStep): boolean {
  return canCapture(board, width, height, step.origin, step.target)
}

export interface ReplayResult {
  ok: boolean
  /** 依次执行后的盘面 */
  board: number[]
  /** 逐步重放时构造出的完整 step（含棋子类型） */
  steps: CaptureStep[]
  /** 失败原因 */
  error: string | null
}

/**
 * 逐步重放吃子序列（不要求最后只剩 1 枚，用于实时校验中途盘面）。
 * 每步必须是合法吃子。
 */
export function replaySteps(
  layout: ArrayLike<number>,
  width: number,
  height: number,
  steps: Array<{ origin: number; target: number }>,
): ReplayResult {
  const board = Array.from(layout, (v) => v | 0)
  const built: CaptureStep[] = []
  for (let i = 0; i < steps.length; i++) {
    const { origin, target } = steps[i]!
    if (origin < 0 || origin >= board.length || target < 0 || target >= board.length) {
      return { ok: false, board, steps: built, error: `第 ${i + 1} 步越界（${origin}→${target}）` }
    }
    const piece = board[origin] | 0
    const captured = board[target] | 0
    if (!isPiece(piece)) {
      return { ok: false, board, steps: built, error: `第 ${i + 1} 步起点 ${origin} 没有棋子` }
    }
    if (!isPiece(captured)) {
      return { ok: false, board, steps: built, error: `第 ${i + 1} 步目标 ${target} 没有棋子（不能走空步）` }
    }
    if (!canCapture(board, width, height, origin, target)) {
      return {
        ok: false,
        board,
        steps: built,
        error: `第 ${i + 1} 步不是合法吃子（${origin}→${target}）`,
      }
    }
    board[target] = piece
    board[origin] = 0
    built.push({ origin, target, piece, captured })
  }
  return { ok: true, board, steps: built, error: null }
}

/**
 * 从头重放吃子序列：每步必须是合法吃子，最后必须只剩 1 枚。
 * 这是「每步是否合法吃子」的唯一权威判断，实时校验与题库审计共用。
 */
export function replaySolution(
  layout: ArrayLike<number>,
  width: number,
  height: number,
  steps: Array<{ origin: number; target: number }>,
): ReplayResult {
  const result = replaySteps(layout, width, height, steps)
  if (!result.ok) return result
  let pieces = 0
  for (const v of result.board) if (isPiece(v)) pieces++
  if (pieces !== 1) {
    return {
      ok: false,
      board: result.board,
      steps: result.steps,
      error: `重放结束后还剩 ${pieces} 枚棋子（应为 1）`,
    }
  }
  return result
}

export interface BuildResult {
  puzzle: ChessPuzzle | null
  error: string | null
}

const DIFFICULTIES = new Set<Puzzle['difficulty']>(['easy', 'medium', 'hard', 'custom'])

/** 把 puzzles-data.ts 的一条原始记录解析成题面；失败给出原因 */
export function buildPuzzle(raw: {
  id: string
  name: string
  width: number
  height: number
  difficulty: string
  board: string
  solution: string
}): BuildResult {
  if (!raw.id) return { puzzle: null, error: '缺 id' }
  if (!raw.name) return { puzzle: null, error: '缺 name' }
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height)) {
    return { puzzle: null, error: '宽高不是整数' }
  }
  if (raw.width < 3 || raw.height < 3 || raw.width > 10 || raw.height > 8) {
    return { puzzle: null, error: `宽高 ${raw.width}×${raw.height} 超出 3..10 × 3..8` }
  }
  if (!DIFFICULTIES.has(raw.difficulty as Puzzle['difficulty'])) {
    return { puzzle: null, error: `难度非法：${raw.difficulty}` }
  }
  const size = raw.width * raw.height
  const layout = decodeLayout(raw.board, size)
  if (!layout) return { puzzle: null, error: `board 编码非法或长度不是 ${size}` }
  let pieces = 0
  for (const v of layout) if (isPiece(v)) pieces++
  if (pieces < 3) return { puzzle: null, error: `棋子太少（${pieces} 枚）` }

  const parsed = decodeSteps(raw.solution)
  if (!parsed) return { puzzle: null, error: 'solution 编码非法' }
  if (parsed.length !== pieces - 1) {
    return {
      puzzle: null,
      error: `解长度 ${parsed.length} != 棋子数-1 ${pieces - 1}`,
    }
  }
  const replay = replaySolution(layout, raw.width, raw.height, parsed)
  if (!replay.ok) return { puzzle: null, error: `参考解不合法：${replay.error}` }

  return {
    puzzle: {
      id: raw.id,
      name: raw.name,
      width: raw.width,
      height: raw.height,
      difficulty: raw.difficulty as Puzzle['difficulty'],
      layout,
      solution: replay.steps,
    },
    error: null,
  }
}

const builtMap = new Map<string, ChessPuzzle>()

export const builtinPuzzles: Puzzle[] = RAW_PUZZLES.map((raw) => {
  const { puzzle } = buildPuzzle(raw)
  if (!puzzle) return null
  builtMap.set(puzzle.id, puzzle)
  return puzzle as Puzzle
}).filter((p): p is Puzzle => p !== null)

/** 回到题面初始盘面（参考解从它开始） */
export function replayPuzzleSolution(puzzle: ChessPuzzle): GameState | null {
  const p = asChessPuzzle(puzzle)
  if (!Array.isArray(p.solution) || p.solution.length === 0) return null
  const replay = replaySolution(p.layout, p.width, p.height, p.solution)
  if (!replay.ok) return null
  return stateFromSteps(p, replay.steps)
}

export function getReferenceSolution(id: string): GameState | null {
  const puzzle = builtMap.get(id)
  if (!puzzle) return null
  return replayPuzzleSolution(puzzle)
}

/** 供脚本 / 调试：全部内置题（解析成功的） */
export function builtinChessPuzzles(): ChessPuzzle[] {
  return [...builtMap.values()]
}

/** 重新导出编码工具，方便生成脚本使用 */
export { encodeLayout, encodeSteps, KING }
