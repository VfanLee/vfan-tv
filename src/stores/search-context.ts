import { create } from 'zustand'
import { keyBy } from 'es-toolkit/array'
import type { VodSearchResult } from '@/types'

interface SearchContextState {
  keyword: string
  candidates: VodSearchResult[]
  setContext: (keyword: string, candidates: VodSearchResult[]) => void
  mergeCandidates: (candidates: VodSearchResult[]) => void
  clear: () => void
}

/** 保存本次运行的搜索上下文，刷新后的播放恢复由数据库记录提供 */
export const useSearchContextStore = create<SearchContextState>()((set) => ({
  keyword: '',
  candidates: [],
  setContext: (keyword, candidates) => set({ keyword, candidates }),
  mergeCandidates: (candidates) => set((state) => ({ candidates: mergeCandidates(state.candidates, candidates) })),
  clear: () => set({ keyword: '', candidates: [] }),
}))

/** 合并同一源与视频的搜索结果 */
function mergeCandidates(currentCandidates: VodSearchResult[], nextCandidates: VodSearchResult[]): VodSearchResult[] {
  return Object.values(keyBy([...currentCandidates, ...nextCandidates], getCandidateKey))
}

/** 获取候选视频的业务唯一键 */
function getCandidateKey(item: VodSearchResult): string {
  return `${item.sourceId}:${item.vodId}`
}
