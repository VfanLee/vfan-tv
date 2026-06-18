import type { HomeData } from '@shared/types'
import type { RecentPlayRepository } from '../repositories/recent-play.repository'
import type { DoubanService } from './douban.service'

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
