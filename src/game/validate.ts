/**
 * 独棋 —— 实时校验
 *
 * 校验三件事：
 *   1. 剩余棋子数；
 *   2. 已经走过的每一步是否都是合法吃子（从初始布局逐步重放历史）；
 *   3. 是否达成「只剩一个棋子」。
 * 另外给出当前盘面的可吃子数量，作为「还能不能继续」的提示。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { countPieces, legalMoves } from './rules.ts'
import { replaySteps } from './puzzles.ts'
import { asChessPuzzle, asChessState, isPiece, type ChessResult, type ChessState } from './types.ts'

function sameBoard(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if ((a[i] | 0) !== (b[i] | 0)) return false
  return true
}

function layoutOf(state: ChessState, puzzle: ReturnType<typeof asChessPuzzle>): number[] {
  if (Array.isArray(puzzle.layout) && puzzle.layout.length === puzzle.width * puzzle.height) {
    return puzzle.layout.map((v) => (isPiece(v) ? v : 0))
  }
  if (Array.isArray(state.initial) && state.initial.length === state.board.length) {
    return state.initial.slice()
  }
  return state.board.slice()
}

export function validate(state: GameState, puzzle: Puzzle): ChessResult {
  const s = asChessState(state)
  const p = asChessPuzzle(puzzle)
  const initial = layoutOf(s, p)
  const width = s.width
  const height = s.height
  const issues: string[] = []

  const replay = replaySteps(initial, width, height, s.history)
  const historyOk = replay.ok && sameBoard(replay.board, s.board)
  if (!replay.ok) {
    issues.push(replay.error ?? '吃子历史不合法')
  } else if (!sameBoard(replay.board, s.board)) {
    issues.push('当前盘面与吃子历史不一致（可能是被手动改过）')
  }

  const pieces = countPieces(s.board)
  const initialPieces = countPieces(initial)
  const captures = s.history.length
  if (historyOk && initialPieces - captures !== pieces) {
    issues.push(`吃子步数 ${captures} 与剩余棋子 ${pieces} 不一致`)
  }

  const legal = legalMoves(s.board, width, height).length
  const stuck = pieces > 1 && legal === 0
  const solved = historyOk && pieces === 1 && replay.ok

  return {
    solved,
    pieces,
    initialPieces,
    captures,
    legal,
    historyOk,
    stuck,
    issues,
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as ChessResult
  const bits: string[] = []
  if (r.solved) {
    bits.push(`完成：只剩 1 枚棋子（共吃 ${r.captures} 步）`)
    return bits
  }
  bits.push(`剩余 ${r.pieces} 枚棋子 · 还需吃 ${Math.max(0, r.pieces - 1)} 步`)
  if (r.historyOk) bits.push(`已吃 ${r.captures} 步（逐步合法）`)
  else bits.push(`历史校验失败：${r.issues[0] ?? '存在非法步骤'}`)
  if (r.stuck) bits.push('已无可吃子，进入死局 —— 撤销后换一条吃法')
  else bits.push(`当前可吃 ${r.legal} 种`)
  return bits
}
