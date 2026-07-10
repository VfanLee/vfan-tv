import { useEffect, useState } from 'react'
import type { VodSearchResult } from '@shared/types'
import { addFavorite, isApiAvailable, isFavorite as checkIsFavorite, removeFavorite } from '@renderer/services/api'
import { createFavoriteInput } from '../utils'

interface VodFavoriteState {
  isCurrentFavorite: boolean
  isLoading: boolean
  toggle: () => Promise<void>
}

export function useVodFavorite(current: VodSearchResult | undefined, resourceKey: string): VodFavoriteState {
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteResourceKey, setFavoriteResourceKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isCurrentFavorite = Boolean(current) && favoriteResourceKey === resourceKey && isFavorite

  const toggle = async (): Promise<void> => {
    if (!current || !isApiAvailable() || isLoading) return
    setIsLoading(true)
    try {
      if (isCurrentFavorite) {
        await removeFavorite(current.sourceId, current.vodId)
        setIsFavorite(false)
        setFavoriteResourceKey(resourceKey)
        return
      }
      await addFavorite(createFavoriteInput(current))
      setIsFavorite(true)
      setFavoriteResourceKey(resourceKey)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!current || !isApiAvailable()) return
    let active = true
    void checkIsFavorite(current.sourceId, current.vodId).then((nextValue) => {
      if (active) {
        setIsFavorite(nextValue)
        setFavoriteResourceKey(`${current.sourceId}:${current.vodId}`)
      }
    })
    return () => {
      active = false
    }
  }, [current])

  return { isCurrentFavorite, isLoading, toggle }
}
