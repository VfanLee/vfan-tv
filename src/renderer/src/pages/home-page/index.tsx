import { useEffect, useMemo, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { RecentPlayItem, RecommendationItem } from '@shared/types'
import { ConfirmDialog } from '@renderer/components'
import { categoryIcons, categorySections } from '@renderer/constants'
import { useRecentPlays } from '@renderer/hooks'
import { recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useAppDataStore, useSearchContextStore } from '@/stores'
import {
  EmptyShelf,
  HomeShelfSkeleton,
  RecentPlayCard,
  RecommendationCard,
  SectionHeader,
} from './components/home-shelf'

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const homeData = useAppDataStore((state) => state.homeData)
  const isLoading = useAppDataStore((state) => !state.homeInitialized && !state.homeErrorMessage)
  const loadHome = useAppDataStore((state) => state.loadHome)
  const { recentPlays, isLoading: recentLoading, deleteRecentPlay } = useRecentPlays({ limit: 20 })
  const [pendingDeleteRecent, setPendingDeleteRecent] = useState<RecentPlayItem>()

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  const recommendationsByCategory = useMemo(() => {
    return categorySections.reduce(
      (groupedRecommendations, section) => {
        groupedRecommendations[section.key] = homeData.recommendations.filter((item) => item.category === section.key)
        return groupedRecommendations
      },
      {} as Record<RecommendationItem['category'], RecommendationItem[]>,
    )
  }, [homeData.recommendations])

  const handleDeleteRecent = async (item: RecentPlayItem): Promise<void> => {
    try {
      await deleteRecentPlay(item)
      toast.success('已删除播放记录')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-7">
      <div className="mx-auto max-w-[1500px]">
        <section className="mb-11">
          <SectionHeader icon={Clock3} title="最近播放" onMore={() => navigate('/recent')} />
          {recentLoading ? (
            <HomeShelfSkeleton />
          ) : recentPlays.length > 0 ? (
            <div className="no-scrollbar grid auto-cols-[220px] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
              {recentPlays.map((item) => (
                <RecentPlayCard
                  key={item.id}
                  item={item}
                  onClick={() => {
                    setContext(item.title, [recentPlayToVodSearchResult(item)])
                    navigate(`/vod/${item.sourceId}/${item.vodId}`, {
                      state: {
                        episodeUrl: item.episodeUrl,
                        initialTime: item.currentTime,
                      },
                    })
                  }}
                  onDelete={() => setPendingDeleteRecent(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyShelf
              description={recentLoading ? '正在加载最近播放' : '播放过的视频会出现在这里'}
              title="还没有播放记录"
            />
          )}
        </section>

        <div className="space-y-11">
          {categorySections.map((section) => {
            const items = recommendationsByCategory[section.key]
            const Icon = categoryIcons[section.key]

            return (
              <section key={section.key}>
                <SectionHeader icon={Icon} title={section.title} onMore={() => navigate(`/hot/${section.key}`)} />
                {isLoading ? (
                  <HomeShelfSkeleton />
                ) : items.length > 0 ? (
                  <div className="no-scrollbar grid auto-cols-[220px] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
                    {items.map((item) => (
                      <RecommendationCard
                        key={`${item.category}-${item.id}`}
                        item={item}
                        onClick={() => navigate(`/search?keyword=${encodeURIComponent(item.title)}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyShelf
                    description={isLoading ? '正在加载热门推荐' : `暂时没有拿到热门${section.title}`}
                    title={`${section.title}推荐`}
                  />
                )}
              </section>
            )
          })}
        </div>
      </div>
      {pendingDeleteRecent ? (
        <ConfirmDialog
          confirmText="删除"
          description={`确定删除「${pendingDeleteRecent.title}」的播放记录吗？`}
          title="删除播放记录"
          onCancel={() => setPendingDeleteRecent(undefined)}
          onConfirm={async () => {
            await handleDeleteRecent(pendingDeleteRecent)
            setPendingDeleteRecent(undefined)
          }}
        />
      ) : null}
    </div>
  )
}
