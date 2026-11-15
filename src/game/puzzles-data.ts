/* 自动生成，勿手改。运行 npm run gen 重新生成。 */

export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串：每格 1 个字符，0=空 1=兵 2=马 3=象 4=车 5=后 6=王 */
  board: string
  /** 参考解编码串：origin-target;origin-target（0 基索引） */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "ranger-01", name: "四子小试", width: 4, height: 4, difficulty: 'easy', series: "4×4 入门", board: "4200003000000200", solution: "6-1;0-1;1-13" },
  { id: "ranger-02", name: "双象奇袭", width: 4, height: 4, difficulty: 'easy', series: "4×4 入门", board: "0000350020030400", solution: "13-5;5-4;4-8;8-11" },
  { id: "ranger-03", name: "马踏连营", width: 5, height: 5, difficulty: 'easy', series: "5×5 进阶", board: "0000000000000000062010602", solution: "22-18;18-17;24-17;17-20" },
  { id: "ranger-04", name: "车行直道", width: 5, height: 5, difficulty: 'medium', series: "5×5 进阶", board: "1000005006000002000000042", solution: "23-24;6-9;9-24;24-0;0-15" },
  { id: "ranger-05", name: "后王协奏", width: 6, height: 6, difficulty: 'medium', series: "6×6 挑战", board: "000000000000010040300030100000060000", solution: "31-24;16-22;22-18;24-18;18-13" },
  { id: "ranger-06", name: "斜线突进", width: 6, height: 6, difficulty: 'medium', series: "6×6 挑战", board: "000300000000010000000100012002000060", solution: "3-13;13-34;26-34;29-21;34-21;21-25" },
  { id: "ranger-07", name: "七子迷阵", width: 7, height: 7, difficulty: 'hard', series: "7×7 专家", board: "0400000063000002000003000000000000000001030000000", solution: "1-8;21-15;41-9;8-15;9-15;15-39" },
  { id: "ranger-08", name: "八子终局", width: 8, height: 8, difficulty: 'hard', series: "8×8 专家", board: "0000000040000000630000001000000010001100000100000000000000000000", solution: "8-16;17-24;16-24;24-32;43-36;32-36;36-37" },
]
