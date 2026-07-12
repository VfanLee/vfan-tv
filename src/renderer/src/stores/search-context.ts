import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { SEARCH_CONTEXT_STORAGE_KEY } from '@shared/constants'
import type { VodSearchResult } from '@shared/types'

interface SearchContextState {
  keyword: string
  candidates: VodSearchResult[]
  setContext: (keyword: string, candidates: VodSearchResult[]) => void
  mergeCandidates: (candidates: VodSearchResult[]) => void
  clear: () => void
}

export const useSearchContextStore = create<SearchContextState>()(
  persist(
    (set) => ({
      keyword: '',
      candidates: [],
      setContext: (keyword, candidates) => set({ keyword, candidates }),
      mergeCandidates: (candidates) =>
        set((state) => ({
          candidates: mergeCandidates(state.candidates, candidates),
        })),
      clear: () => set({ keyword: '', candidates: [] }),
    }),
    {
      name: SEARCH_CONTEXT_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        keyword: state.keyword,
        candidates: state.candidates,
      }),
    },
  ),
)

function mergeCandidates(currentCandidates: VodSearchResult[], nextCandidates: VodSearchResult[]): VodSearchResult[] {
  const map = new Map<string, VodSearchResult>()

  for (const item of currentCandidates) {
    map.set(getCandidateKey(item), item)
  }

  for (const item of nextCandidates) {
    map.set(getCandidateKey(item), item)
  }

  return Array.from(map.values())
}

function getCandidateKey(item: VodSearchResult): string {
  return `${item.sourceId}:${item.vodId}`
}
