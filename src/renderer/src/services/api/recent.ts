import type { RecentPlayInput, RecentPlayItem } from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function listRecentPlays(limit?: number): Promise<RecentPlayItem[]> {
  const api = getRuntimeApi()
  return api ? api.recent.list(limit) : []
}

export async function upsertRecentPlay(input: RecentPlayInput): Promise<RecentPlayItem | undefined> {
  const api = getRuntimeApi()
  return api ? api.recent.upsert(input) : undefined
}

export async function removeRecentPlay(title: string): Promise<void> {
  await requireRuntimeApi().recent.remove(title)
}
