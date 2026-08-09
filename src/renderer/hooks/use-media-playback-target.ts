import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaPlaybackCandidate, MediaPlaybackTarget, MediaPlaybackTargetInput } from '@shared/types'
import { getMediaPlaybackTarget, releaseMediaPlaybackSession } from '@renderer/platform/api'

interface ResolutionState {
  key: string
  target?: MediaPlaybackTarget
  errorMessage?: string
}

export function useMediaPlaybackTarget(input: MediaPlaybackTargetInput | undefined): {
  target?: MediaPlaybackTarget
  errorMessage?: string
  isLoading: boolean
  retry: () => void
} {
  const [retryKey, setRetryKey] = useState(0)
  const candidatesKey = JSON.stringify(input?.candidates ?? [])
  const sourceId = input?.sourceId
  const sourceName = input?.diagnostics?.sourceName
  const episodeName = input?.diagnostics?.episodeName
  const requestKey = useMemo(
    () => `${candidatesKey}\u0000${sourceId ?? ''}\u0000${sourceName ?? ''}\u0000${episodeName ?? ''}\u0000${retryKey}`,
    [candidatesKey, episodeName, retryKey, sourceId, sourceName],
  )
  const stableCandidates = useMemo(() => JSON.parse(candidatesKey) as MediaPlaybackCandidate[], [candidatesKey])
  const requestInput = useMemo<MediaPlaybackTargetInput | undefined>(
    () =>
      stableCandidates.length > 0
        ? { candidates: stableCandidates, sourceId, diagnostics: { sourceName, episodeName } }
        : undefined,
    [episodeName, sourceId, sourceName, stableCandidates],
  )
  const [state, setState] = useState<ResolutionState>({ key: '' })
  const ownedSessionIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const previousSessionId = ownedSessionIdRef.current
    ownedSessionIdRef.current = undefined
    if (previousSessionId) void releaseMediaPlaybackSession(previousSessionId)
    if (!requestInput || requestInput.candidates.length === 0) return
    let active = true
    void getMediaPlaybackTarget(requestInput)
      .then((target) => {
        if (!active) {
          void releaseMediaPlaybackSession(target.mediaSessionId)
          return
        }
        ownedSessionIdRef.current = target.mediaSessionId
        setState({ key: requestKey, target })
      })
      .catch((error: unknown) => {
        if (active) setState({ key: requestKey, errorMessage: toErrorMessage(error) })
      })
    return () => {
      active = false
    }
  }, [requestInput, requestKey])

  useEffect(
    () => () => {
      const mediaSessionId = ownedSessionIdRef.current
      ownedSessionIdRef.current = undefined
      if (mediaSessionId) void releaseMediaPlaybackSession(mediaSessionId)
    },
    [],
  )

  const isCurrent = state.key === requestKey
  return {
    target: isCurrent ? state.target : undefined,
    errorMessage: isCurrent ? state.errorMessage : undefined,
    isLoading: Boolean(input?.candidates.length && !isCurrent),
    retry: useCallback(() => setRetryKey((value) => value + 1), []),
  }
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
}
