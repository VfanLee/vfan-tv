import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion, RadioSearchResult } from '@shared/types'
import { requireRuntimeApi } from './client'

export function getRadioCategories(): Promise<RadioCategory[]> {
  return requireRuntimeApi().radio.getCategories()
}

export function getRadioCategoryChannels(categoryId: number, page = 1, pageSize = 20): Promise<RadioChannel[]> {
  return requireRuntimeApi().radio.getCategoryChannels(categoryId, page, pageSize)
}

export function getRadioChannelDetail(channelId: number): Promise<RadioChannel> {
  return requireRuntimeApi().radio.getChannelDetail(channelId)
}

export function searchRadioChannels(keyword: string, page = 1, pageSize = 30): Promise<RadioSearchResult> {
  return requireRuntimeApi().radio.searchChannels(keyword, page, pageSize)
}

export function getRadioLivePrograms(channelIds: number[]): Promise<RadioLiveProgram[]> {
  return requireRuntimeApi().radio.getLivePrograms(channelIds)
}

export function getRadioRegions(): Promise<RadioRegion[]> {
  return requireRuntimeApi().radio.getRegions()
}

export function getRadioBillboard(categoryId: number, regionId: number): Promise<RadioChannel[]> {
  return requireRuntimeApi().radio.getBillboard(categoryId, regionId)
}
