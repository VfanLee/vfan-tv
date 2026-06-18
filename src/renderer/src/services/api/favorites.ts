import type { FavoriteInput, FavoriteItem } from '@shared/types'
import { getRuntimeApi, requireRuntimeApi } from './client'

export async function listFavorites(): Promise<FavoriteItem[]> {
  const api = getRuntimeApi()
  return api ? api.favorites.list() : []
}

export async function isFavorite(sourceId: string, vodId: string): Promise<boolean> {
  const api = getRuntimeApi()
  return api ? api.favorites.isFavorite(sourceId, vodId) : false
}

export async function addFavorite(input: FavoriteInput): Promise<FavoriteItem> {
  return requireRuntimeApi().favorites.add(input)
}

export async function removeFavorite(sourceId: string, vodId: string): Promise<void> {
  await requireRuntimeApi().favorites.remove(sourceId, vodId)
}
