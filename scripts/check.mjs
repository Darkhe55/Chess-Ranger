/**
 * 独棋题库审计
 *
 * 逐题检查：
 *   1. 元数据（id 唯一 / 名称 / 难度 / 宽高范围）；
 *   2. 题面编码长度与棋子数量（至少 3 枚）；solution 长度 = 棋子数 - 1；
 *   3. 参考解逐步重放：每一步都是合法吃子，最后恰好剩 1 枚；
 *   4. 参考解通过实时校验（validate().solved）；
 *   5. 求解器做唯一性审计：`countSolutions` 上限 2 条、带节点数与墙钟预算，
 *      必须完整搜完且只找到 1 条解（超时视为失败，避免「不知道是否唯一」）。
 *
 * 依赖 Node 24 的原生 TypeScript 类型剥离，直接 import src/game/*.ts。
 */

import { RAW_PUZZLES } from '../src/game/puzzles-data.ts'
import {
  builtinChessPuzzles,
  buildPuzzle,
  getReferenceSolution,
  replaySolution,
} from '../src/game/puzzles.ts'
import { countPieces } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'
import { validate } from '../src/game/validate.ts'
import { decodeLayout, decodeSteps } from '../src/game/types.ts'

const MIN_PUZZLES = 6
const MAX_NODES = 2_000_000
const MAX_MILLIS = 15_000

let errors = 0
let warnings = 0
const ids = new Set()

if (RAW_PUZZLES.length < MIN_PUZZLES) {
  console.error(`[check] 内置题只有 ${RAW_PUZZLES.length} 道，至少需要 ${MIN_PUZZLES} 道`)
  errors++
}

for (const raw of RAW_PUZZLES) {
  const tag = raw.id || '(无 id)'
  const fail = (msg) => {
    console.error(`[check] ${tag} ${msg}`)
    errors++
  }

  // —— 元数据 ——
  if (!raw.id) fail('缺 id')
  else if (ids.has(raw.id)) fail('id 重复')
  ids.add(raw.id)
  if (!raw.name) fail('缺 name')
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height)) {
    fail('宽高不是整数')
    continue
  }
  if (raw.width < 3 || raw.height < 3 || raw.width > 10 || raw.height > 8) {
    fail(`宽高 ${raw.width}×${raw.height} 超出 3..10 × 3..8`)
    continue
  }
  if (!['easy', 'medium', 'hard', 'custom'].includes(raw.difficulty)) {
    fail(`难度非法：${raw.difficulty}`)
  }

  // —— 编码 ——
  const size = raw.width * raw.height
  const layout = decodeLayout(raw.board, size)
  if (!layout) {
    fail(`board 编码非法（长度 ${raw.board.length}，应为 ${size}）`)
    continue
  }
  const parsed = decodeSteps(raw.solution)
  if (!parsed) {
    fail('solution 编码非法')
    continue
  }
  const pieces = countPieces(layout)
  if (pieces < 3) {
    fail(`棋子太少（${pieces} 枚，至少 3 枚）`)
    continue
  }
  if (parsed.length !== pieces - 1) {
    fail(`solution 步数 ${parsed.length} != 棋子数-1 ${pieces - 1}`)
    continue
  }

  // —— 参考解重放 ——
  const replay = replaySolution(layout, raw.width, raw.height, parsed)
  if (!replay.ok) {
    fail(`参考解不合法：${replay.error}`)
    continue
  }

  // —— 题目解析 ——
  const built = buildPuzzle({
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    board: raw.board,
    solution: raw.solution,
  })
  if (!built.puzzle) {
    fail(`题面解析失败：${built.error}`)
    continue
  }

  // —— 参考解终态通过实时校验 ——
  const reference = getReferenceSolution(raw.id)
  if (!reference) {
    fail('getReferenceSolution 返回 null')
    continue
  }
  const referenceCheck = validate(reference, built.puzzle)
  if (!referenceCheck.solved) {
    fail(`参考解终态未通过校验：${referenceCheck.issues.join('；') || '未知原因'}`)
    continue
  }

  // —— 唯一性审计 ——
  const outcome = countSolutions(layout, raw.width, raw.height, 2, {
    maxNodes: MAX_NODES,
    maxMillis: MAX_MILLIS,
  })
  if (outcome.timedOut) {
    fail(`唯一性审计超时（${outcome.nodes} 节点，${MAX_MILLIS}ms）`)
    continue
  }
  if (outcome.solutions.length !== 1) {
    fail(`解不唯一：找到 ${outcome.solutions.length} 条`)
    continue
  }
  const solverSteps = outcome.solutions[0].map((s) => `${s.origin}-${s.target}`)
  const storedSteps = parsed.map((s) => `${s.origin}-${s.target}`)
  if (solverSteps.join(';') !== storedSteps.join(';')) {
    warnings++
    console.warn(`[check] ${tag} 参考解与求解器找到的唯一解顺序不同（都合法，仅提示）`)
  }

  const counts = { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 }
  const letters = ['', 'P', 'N', 'B', 'R', 'Q', 'K']
  for (const v of layout) if (v) counts[letters[v]]++
  const pieceText = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}${n}`)
    .join(' ')

  console.log(
    `[check] ${raw.name.padEnd(5, ' ')} ${String(raw.width + '×' + raw.height).padEnd(5, ' ')} ${String(pieces).padStart(2)} 枚 [${pieceText}] · ${parsed.length} 步 · 唯一解（${outcome.nodes} 节点）`,
  )
}

// —— 题库整体 ——
const loaded = builtinChessPuzzles()
if (loaded.length !== RAW_PUZZLES.length) {
  console.error(`[check] builtinPuzzles 载入 ${loaded.length} 道，原始 ${RAW_PUZZLES.length} 道`)
  errors++
}
if (errors === 0) {
  console.log(`[check] 共 ${RAW_PUZZLES.length} 题，全部有解且唯一解；错误 0，警告 ${warnings}`)
} else {
  console.error(`[check] 共 ${RAW_PUZZLES.length} 题，错误 ${errors}，警告 ${warnings}`)
  process.exitCode = 1
}
