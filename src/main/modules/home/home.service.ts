import type { HomeData } from '@shared/types'
import type { RecentPlayRepository } from '../library/recent-play.repository'
import type { DoubanService } from './douban.service'

/** 聚合本地最近播放与豆瓣推荐，形成首页首屏数据 */
export class HomeService {
  constructor(
    private readonly recentPlayRepository: RecentPlayRepository,
    private readonly doubanService: DoubanService,
  ) {}

  async get(): Promise<HomeData> {
    return {
      recentPlays: this.recentPlayRepository.list(20),
      recommendations: await this.doubanService.getRecentHot(),
    }
  }
}
