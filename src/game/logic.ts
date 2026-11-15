/**
 * 独棋 —— 「逻辑解题」回放计划
 *
 * 独棋没有像数独那样的局部推理规则，本解法把求解器的搜索过程包装成回放：
 *   1. 先用回溯搜索找出一条完整吃子序列（带预算/超时）；
 *   2. 对序列里的每一步，检查当前盘面「有多少个吃子还能走向胜利」：
 *        - 只有唯一一个 → 标注「唯一可行吃子」（规则 1）；
 *        - 否则 → 标注「搜索」（规则 2）。
 *   3. 全部步骤都是必然步骤时 saturated=true（不需要猜测）。
 *
 * 这样回放时每一步都有可读的理由，也方便玩家对照学习。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { applyCapture, countPieces, legalMoves, undoCapture } from './rules.ts'
import { CaptureSolver } from './solver.ts'
import { applyMove, makeCaptureMove } from './state.ts'
import {
  asChessPuzzle,
  asChessState,
  stepText,
  type CaptureStep,
  type ChessState,
} from './types.ts'

const FORCED_RULE = 1
const SEARCH_RULE = 2

/** 逻辑回放单步判定预算 */
const PROBE_BUDGET = { maxNodes: 120_000, maxMillis: 800 }

function emptyPlan(puzzleId: string): LogicPlan {
  return { puzzleId, frames: [], finalState: null, ruleSteps: 0, saturated: false }
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asChessPuzzle(puzzle)
  const s = asChessState(initialState)
  const width = s.width
  const height = s.height
  const start = Date.now()

  if (countPieces(s.board) <= 1) {
    return {
      puzzleId: p.id,
      frames: [],
      finalState: s,
      ruleSteps: 0,
      saturated: true,
    }
  }

  const solver = new CaptureSolver(width, height)
  const found = solver.findSolution(s.board, { maxNodes: 2_000_000, maxMillis: 5000 })
  if (!found.solution) {
    return emptyPlan(p.id)
  }

  const board = s.board.slice()
  const frames: PlaybackFrame[] = []
  const steps: CaptureStep[] = []
  let saturated = true
  let lastRule = 0
  let streak = 0

  for (const step of found.solution) {
    const moves = legalMoves(board, width, height)
    let forced = moves.length === 1
    if (!forced && countPieces(board) <= 9 && Date.now() - start < 2600) {
      let viable = 0
      let unknown = false
      for (const move of moves) {
        applyCapture(board, move)
        const probe = solver.probe(board, PROBE_BUDGET)
        undoCapture(board, move)
        if (probe === 'yes') viable++
        else if (probe === 'unknown') {
          unknown = true
          break
        }
        if (viable > 1) break
      }
      forced = !unknown && viable === 1
    }
    if (!forced) saturated = false

    const rule = forced ? FORCED_RULE : SEARCH_RULE
    if (rule === lastRule) streak++
    else {
      lastRule = rule
      streak = 1
    }
    frames.push({
      rule,
      label: forced
        ? `唯一可行吃子：${stepText(step, width, height)}`
        : `搜索：${stepText(step, width, height)}`,
      move: makeCaptureMove(step),
      streak,
    })
    applyCapture(board, step)
    steps.push(step)
  }

  return {
    puzzleId: p.id,
    frames,
    finalState: buildFinalState(s, steps),
    ruleSteps: frames.length,
    saturated,
  }
}

function buildFinalState(snapshot: ChessState, steps: CaptureStep[]): GameState {
  const state: ChessState = {
    ...snapshot,
    board: snapshot.board.slice(),
    initial: snapshot.initial.slice(),
    history: snapshot.history.map((h) => ({ ...h })),
    invalid: null,
    lastMove: null,
    selected: -1,
    cursor: -1,
  }
  for (const step of steps) {
    applyMove(state, makeCaptureMove(step))
  }
  return state
}
