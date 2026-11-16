/**
 * 独棋（Chess Ranger / Solo Chess）—— 从题图截图自动导入题库
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--name 名称] [--id ID] [--series 系列]
 *                                 [--append] [--verify] [--dry]
 *                                 [--map 簇号=棋子编号,...] [--budget 节点数]
 *
 * 棋子编号：1=兵 2=马 3=象 4=车 5=后 6=王（与 src/game/types.ts 一致）
 *
 * 流程：
 *   1. Playwright + Edge 打开图片到 canvas，取像素；
 *   2. 用棋盘深浅格颜色定位棋盘并切出 8×8（按颜色跳变自动数行列）；
 *   3. 每格用「该格主色」做背景差，得到棋子墨迹 → 归一化 32×32；
 *   4. 按 IoU 聚类字形；每个簇与内置国际象棋字形模板比对，自动判定棋子类型；
 *      置信度不足时打印候选簇，可用 --map 人工指定；
 *   5. 交给 src/game/solver.ts 求解（--verify 额外统计唯一性，超时只警告）；
 *   6. 预览棋盘；--append 追加到 src/game/puzzles-data.ts。
 *
 * 说明：内置模板是按 lichess / cburnett 风格棋子（白/黑通用）归一化得到的轮廓；
 *       其它棋子字体识别率会下降，此时用 --map 按「簇号=棋子编号」覆盖即可。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { countSolutions, findSolution } from '../src/game/solver.ts'

const PIECE_NAMES = { 1: '兵', 2: '马', 3: '象', 4: '车', 5: '后', 6: '王' }
const PIECE_LETTERS = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' }

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p
  throw new Error('找不到 Microsoft Edge，可用环境变量 EDGE_PATH 指定 msedge.exe 路径')
}

function parseArgs(argv) {
  const out = { file: null, name: null, id: null, series: '识图', append: false, verify: false, dry: false, maps: {}, budget: 1_500_000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`参数 ${a} 缺少值`)
      return v
    }
    if (a === '--name') out.name = next()
    else if (a === '--id') out.id = next()
    else if (a === '--series') out.series = next()
    else if (a === '--append') out.append = true
    else if (a === '--verify') out.verify = true
    else if (a === '--dry') out.dry = true
    else if (a === '--budget') out.budget = Math.max(1000, Number(next()) || 0)
    else if (a === '--map') {
      for (const token of next().split(',')) {
        const m = /^(\d+)=(\d)$/.exec(token.trim())
        if (!m) fail(`--map 格式应为 簇号=棋子编号，收到「${token}」`)
        out.maps[Number(m[1])] = Number(m[2])
      }
    } else if (!a.startsWith('--')) {
      if (out.file) fail(`多余参数 ${a}`)
      out.file = a
    } else fail(`未知参数 ${a}`)
  }
  if (!out.file) fail('请指定图片路径')
  return out
}
function fail(msg) {
  console.error(`[独棋识图] ${msg}`)
  console.error('用法：node scripts/import-image.mjs <图片路径> [--name 名称] [--id ID] [--series 系列] [--append] [--verify] [--dry] [--map 簇号=编号] [--budget 节点数]')
  process.exit(1)
}

/* ───────────── 内置字形模板（32×32，按包围盒归一化；hex 每 4 bit 一字符） ───────────── */
const PIECE_TEMPLATE_HEX = {
  1: '0003f0000003f0000007fc00001ffe00001ffe00001ffe00001ffe00001ffe00003fff80003fff8000ffffc000ffffc001ffffc001ffffc001ffffc000ffffc000ffffc000ffffc000ffffc000ffffc001fffff007fffff80ffffffe3ffffffe3ffffffe3ffffffe3fffffffffffffffffffffffffffffffffffffff30000000',
  2: '00c3800000c3800001ffc00000fff80000fffe0001ffff8003ffffe007fffff007fffff007fffff007fffff80ffffffc1ffffffc1ffffffc3ffffffc3ffffffefffffffefffffffefffefffefffcfffefff9ffffffc1ffffff83ffff3f07ffff060fffff060fffff003fffff003fffff003fffff007fffff007fffff003ffffe',
  3: '0001c0000001c0000003e0000007e0000007e0000007e0000007f000000ff800003ffc00007ffe00007fff0000ffff0000ffff8000ffff8000ffff8000ffff8000ffff8000ffff8000ffff80007fff00007fff00007ffe00007fff00007fff00007fff00007fff00007ffe00007ffe0007fffff03ffffffeffffffff3ffffffe',
  4: '0fc1f03e0fc1f03e1fffffff1fffffff1fffffff1fffffff0ffffffe0ffffffe0ffffffc03fffffc01ffffe000ffffe000ffffe000ffffe000ffffe000ffffe000ffffe000ffffe000ffffe000ffffe000ffffe001fffff001fffff003fffffc03fffffe03fffffe03fffffe1fffffff33fffffff0000001f000000120000000',
  5: '01c7838001c7838003e7c7c003e7c7c6e1c3878ef1c3870ff0c3870f70c3870e70e3c70e38f3c71c38f3cf3c38f3cf3c3cffcf3c3ffffff83ffffff81ffffff81ffffff81ffffff81ffffff80ffffff00ffffff007ffffe007ffffe003ffffc003ffffc003ffffc003ffffc007ffffc047ffffe04fffffe06bffffc001f00f80',
  6: '0000c0000000c0000001e0000001e0000001c0000001c0000001e0000003f0000007f000060fff300ffffffc1ffffffe1ffffffe3fffffff3fffffff3fffffff3fffffff3fffffff3ffffffe1ffffffe0ffffffc07fffff803ffffe001ffffe001ffffc001ff3fc001ffffc001ffffc0e1ffffc000ffffc0003fff80000e1800',
}
function decodeTemplate(hex) {
  const bits = new Uint8Array(32 * 32)
  for (let i = 0; i < 256; i++) {
    const v = parseInt(hex[i], 16)
    for (let k = 0; k < 4; k++) bits[i * 4 + k] = (v >> (3 - k)) & 1
  }
  return bits
}
const PIECE_TEMPLATES = Object.fromEntries(Object.entries(PIECE_TEMPLATE_HEX).map(([k, v]) => [Number(k), decodeTemplate(v)]))

const args = parseArgs(process.argv.slice(2))
const imagePath = path.resolve(args.file)
if (!existsSync(imagePath)) fail(`找不到图片：${imagePath}`)

const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: findEdge() })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const detected = await page.evaluate(async ({ dataUrl }) => {
  const N = 32
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.getElementById('c')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, W, H).data
  const rgb = (x, y) => {
    const i = (y * W + x) * 4
    return [d[i], d[i + 1], d[i + 2]]
  }
  const dist = (c, t) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2])
  // 主流棋盘主题的深浅格颜色（lichess brown / chess.com green 等常见主题）
  const PALETTES = [
    [[231, 212, 182], [183, 147, 116]],
    [[240, 217, 181], [181, 136, 99]],
    [[238, 238, 210], [118, 150, 86]],
    [[235, 236, 208], [119, 149, 86]],
    [[222, 227, 230], [140, 162, 173]],
    [[238, 238, 210], [118, 150, 86]],
  ]
  let palette = null
  let bestScore = 0
  for (const [light, dark] of PALETTES) {
    const sqClass = (c) => {
      const dl = dist(c, light)
      const dd = dist(c, dark)
      if (Math.min(dl, dd) > 55) return 0
      return dl < dd ? 1 : 2
    }
    // 找棋盘外接矩形：棋盘内部每一列/行都有大量「深浅格」像素，
    // 棋盘外的白边、深色边框、坐标文字都不属于调色板，计数会骤降。
    const colCount = new Int32Array(W)
    const rowCount = new Int32Array(H)
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (!sqClass(rgb(x, y))) continue
        colCount[x]++
        rowCount[y]++
      }
    }
    const colThreshold = (H / 2) * 0.5
    const rowThreshold = (W / 2) * 0.5
    let x0 = -1
    let x1 = -1
    for (let x = 0; x < W; x++) if (colCount[x] >= colThreshold) { if (x0 < 0) x0 = x; x1 = x }
    let y0 = -1
    let y1 = -1
    for (let y = 0; y < H; y++) if (rowCount[y] >= rowThreshold) { if (y0 < 0) y0 = y; y1 = y }
    // 覆盖率校验：真实棋盘区域内几乎所有像素都应属于深浅格两种颜色之一，
    // 否则说明这组调色板只是把背景/边框当成了格子。
    let covered = 0
    let total = 0
    if (x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0) {
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
        const c = rgb(Math.round(x0 + ((x1 - x0) * (i + 0.5)) / 32), Math.round(y0 + ((y1 - y0) * (j + 0.5)) / 32))
        if (sqClass(c) !== 0) covered++
        total++
      }
    }
    const coverage = total ? covered / total : 0
    const aspect = x1 > x0 && y1 > y0 ? Math.min(x1 - x0 + 1, y1 - y0 + 1) / Math.max(x1 - x0 + 1, y1 - y0 + 1) : 0
    const score = coverage >= 0.7 ? coverage * (x1 - x0 + 1) * (y1 - y0 + 1) * aspect : 0
    if (x0 >= 0 && y0 >= 0 && score > bestScore) {
      bestScore = score
      palette = { light, dark, x0, x1, y0, y1, sqClass }
    }
  }
  if (!palette) throw new Error('没有找到棋盘格子颜色，可能不是国际象棋棋盘截图')
  const { light, dark, sqClass } = palette
  // 数行列：沿棋盘中线统计色块跳变
  const midY = Math.round((palette.y0 + palette.y1) / 2)
  const midX = Math.round((palette.x0 + palette.x1) / 2)
  const countRuns = (seq) => {
    let runs = 0
    let last = -1
    for (const v of seq) {
      if (v !== 0 && v !== last) runs++
      if (v !== 0) last = v
    }
    return runs
  }
  const nCols = countRuns(Array.from({ length: palette.x1 - palette.x0 + 1 }, (_, i) => sqClass(rgb(palette.x0 + i, midY))))
  const nRows = countRuns(Array.from({ length: palette.y1 - palette.y0 + 1 }, (_, i) => sqClass(rgb(midX, palette.y0 + i))))
  if (nCols < 3 || nRows < 3 || nCols > 10 || nRows > 8) {
    throw new Error(`棋盘尺寸识别失败：${nCols}×${nRows}（支持 3..10 × 3..8）`)
  }
  const cellW = (palette.x1 - palette.x0 + 1) / nCols
  const cellH = (palette.y1 - palette.y0 + 1) / nRows
  const extract = (cxi, ry) => {
    const x0 = palette.x0 + cxi * cellW
    const y0 = palette.y0 + ry * cellH
    // 背景色：取格子主色中更接近深/浅格调色板的一侧
    let nearL = 0
    let nearD = 0
    for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) {
      const c = rgb(Math.round(x0 + (0.05 + 0.9 * i / 19) * cellW), Math.round(y0 + (0.05 + 0.9 * j / 19) * cellH))
      if (dist(c, light) < 45) nearL++
      if (dist(c, dark) < 45) nearD++
    }
    const bg = nearL >= nearD ? light : dark
    const raw = []
    for (let j = 0; j < N; j++) {
      raw.push([])
      for (let i = 0; i < N; i++) {
        const c = rgb(Math.round(x0 + (0.1 + 0.8 * i / (N - 1)) * cellW), Math.round(y0 + (0.1 + 0.8 * j / (N - 1)) * cellH))
        raw[j].push(dist(c, bg) > 80 ? 1 : 0)
      }
    }
    // 3×3 众数去噪（去掉木纹 / 抗锯齿噪点）
    const m = new Array(N * N).fill(0)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let cnt = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = i + dx
        const Y = j + dy
        if (X >= 0 && Y >= 0 && X < N && Y < N) cnt += raw[Y][X]
      }
      m[j * N + i] = cnt >= 5 ? 1 : 0
    }
    let ink = 0
    for (const v of m) ink += v
    // 归一化到包围盒
    let ax0 = N
    let ay0 = N
    let ax1 = -1
    let ay1 = -1
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (m[j * N + i]) {
      if (i < ax0) ax0 = i
      if (i > ax1) ax1 = i
      if (j < ay0) ay0 = j
      if (j > ay1) ay1 = j
    }
    if (ax1 < 0) return { ink: 0, norm: null }
    const bw = ax1 - ax0 + 1
    const bh = ay1 - ay0 + 1
    const norm = new Array(N * N).fill(0)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) norm[j * N + i] = m[(ay0 + Math.floor(bh * j / N)) * N + (ax0 + Math.floor(bw * i / N))] ? 1 : 0
    return { ink, norm }
  }
  const cells = []
  for (let ry = 0; ry < nRows; ry++) {
    const row = []
    for (let cxi = 0; cxi < nCols; cxi++) row.push(extract(cxi, ry))
    cells.push(row)
  }
  return { W, H, nCols, nRows, cellW, cellH, palette: { light, dark, x0: palette.x0, y0: palette.y0 }, cells }
}, { dataUrl })
await browser.close()

const { nCols, nRows, cells } = detected
console.log(`[独棋识图] ${path.basename(imagePath)}：棋盘 ${nCols}×${nRows}，格子 ${detected.cellW.toFixed(1)}×${detected.cellH.toFixed(1)}px`)

/* ───────────── 字形聚类 + 自动分类 ───────────── */
const sim = (a, b) => {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    if (a[i] || b[i]) union++
  }
  return union ? inter / union : 0
}
const clusters = []
const assign = []
const INK_MIN = 120
for (let ry = 0; ry < nRows; ry++) {
  const row = []
  for (let cxi = 0; cxi < nCols; cxi++) {
    const cell = cells[ry][cxi]
    if (!cell.norm || cell.ink < INK_MIN) {
      row.push(-1)
      continue
    }
    let best = -1
    let bestScore = 0
    for (let k = 0; k < clusters.length; k++) {
      const s = sim(cell.norm, clusters[k].proto)
      if (s > bestScore) {
        bestScore = s
        best = k
      }
    }
    if (best >= 0 && bestScore >= 0.8) {
      clusters[best].count++
      row.push(best)
    } else {
      clusters.push({ proto: cell.norm, count: 1, ink: cell.ink })
      row.push(clusters.length - 1)
    }
  }
  assign.push(row)
}
if (!clusters.length) fail('没有识别到棋子（可能图片不是独棋题面，或棋子与格子底色对比太低）')

const mapping = []
for (let k = 0; k < clusters.length; k++) {
  const scores = Object.entries(PIECE_TEMPLATES)
    .map(([code, tpl]) => [Number(code), sim(clusters[k].proto, tpl)])
    .sort((a, b) => b[1] - a[1])
  const [auto, bestScore] = scores[0]
  const [auto2, secondScore] = scores[1]
  const manual = args.maps[k]
  const code = manual ?? auto
  mapping[k] = code
  const unsure = manual === undefined && (bestScore < 0.62 || bestScore - secondScore < 0.06)
  const tag = manual !== undefined ? '人工' : unsure ? '存疑' : '自动'
  console.log(
    `[独棋识图] 簇${k} → ${PIECE_NAMES[code] ?? code}（${tag}，n=${clusters[k].count}，` +
      `IoU ${bestScore.toFixed(2)} / 次优 ${PIECE_NAMES[auto2] ?? auto2} ${secondScore.toFixed(2)}）`,
  )
  if (unsure) console.warn(`[独棋识图] 警告：簇${k} 置信度低，建议用 --map ${k}=棋子编号 覆盖`)
}

const layout = new Array(nCols * nRows).fill(0)
for (let ry = 0; ry < nRows; ry++) for (let cxi = 0; cxi < nCols; cxi++) {
  const c = assign[ry][cxi]
  if (c >= 0) layout[ry * nCols + cxi] = mapping[c]
}
const board = layout.join('')
const pieceCount = layout.filter((v) => v > 0).length
if (pieceCount < 3) fail(`只识别到 ${pieceCount} 枚棋子（至少需要 3 枚）`)

console.log(`[独棋识图] 棋子 ${pieceCount} 枚，board = ${board}`)
console.log('[独棋识图] 盘面（0 空，P 兵 N 马 B 象 R 车 Q 后 K 王；上方为第 1 行）：')
for (let ry = 0; ry < nRows; ry++) {
  const line = layout.slice(ry * nCols, ry * nCols + nCols).map((v) => (v ? PIECE_LETTERS[v] : '.')).join(' ')
  console.log('  ' + line)
}

if (args.dry) {
  console.log('[独棋识图] --dry：仅识别，不求解、不写入。')
  process.exit(0)
}

/* ───────────── 求解（可选唯一性） ───────────── */
const t0 = Date.now()
const solved = findSolution(layout, nCols, nRows, { maxNodes: args.budget, maxMillis: 15000 })
if (!solved) {
  console.error('[独棋识图] 求解失败：这组棋子没有合法吃子序列（识别可能有误，或题目本身无解）。')
  console.error('[独棋识图] 可用 --map 修正识别结果后重试；如果确认棋子无误，加 --dry 只识别。')
  process.exit(1)
}
const solution = solved.map((s) => `${s.origin}-${s.target}`).join(';')
console.log(`[独棋识图] 找到解：${solved.length} 步（${Date.now() - t0}ms）；${solution}`)
if (args.verify) {
  const counted = countSolutions(layout, nCols, nRows, 2, { maxNodes: args.budget, maxMillis: 15000 })
  if (counted.timedOut) console.warn('[独棋识图] 警告：唯一性检查超时，未能确认解唯一（导入仍会使用找到的第一组解）')
  else if (counted.solutions.length > 1) console.warn(`[独棋识图] 警告：解不唯一（至少 ${counted.solutions.length} 条），导入仍使用找到的第一组解`)
  else console.log('[独棋识图] 唯一解 ✓')
}

if (!args.append) {
  console.log('[独棋识图] 预览模式，未写入题库。加 --append 写入 src/game/puzzles-data.ts。')
  process.exit(0)
}

/* ───────────── 写入题库 ───────────── */
const id = args.id || `ranger-import-${Date.now().toString(36)}`
const name = args.name || `识图 · ${nCols}×${nRows}`
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${nCols}, height: ${nRows}, difficulty: 'hard', series: ${JSON.stringify(args.series)}, board: ${JSON.stringify(board)}, solution: ${JSON.stringify(solution)} },\n`
const dataFile = path.resolve('src/game/puzzles-data.ts')
if (!existsSync(dataFile)) fail(`找不到题库文件：${dataFile}`)
let text = readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
const marker = text.lastIndexOf('\n]')
if (marker < 0) fail('puzzles-data.ts 格式异常：找不到结尾 ]')
text = text.slice(0, marker + 1) + '\n' + entry + text.slice(marker + 1)
writeFileSync(dataFile, text)
console.log(`[独棋识图] 已写入 ${dataFile}`)
console.log(`[独棋识图] id=${id}  name=${name}`)
console.log('[独棋识图] 注意：npm run gen 会重新生成该文件并覆盖导入内容。')
