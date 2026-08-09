import type {
  IptvEpgSettings,
  IptvEpgTestResult,
  IptvPlaybackTarget,
  IptvPlaylist,
  IptvProgramScheduleResult,
  IptvProgramsResult,
} from '@shared/types'
import { requireRuntimeApi } from './client'

export async function getIptvCatalog(sourceId: string, force = false): Promise<IptvPlaylist> {
  return requireRuntimeApi().iptv.getCatalog(sourceId, force)
}

export async function getIptvPrograms(sourceId: string, channelIds: string[]): Promise<IptvProgramsResult> {
  return requireRuntimeApi().iptv.getPrograms(sourceId, channelIds)
}

export async function getIptvProgramSchedule(
  sourceId: string,
  channelId: string,
  date: string,
): Promise<IptvProgramScheduleResult> {
  return requireRuntimeApi().iptv.getProgramSchedule(sourceId, channelId, date)
}

export async function getIptvPlaybackTarget(
  sourceId: string,
  channelId: string,
  streamId: string,
): Promise<IptvPlaybackTarget> {
  return requireRuntimeApi().iptv.getPlaybackTarget(sourceId, channelId, streamId)
}

export async function testIptvEpg(settings?: IptvEpgSettings): Promise<IptvEpgTestResult> {
  return requireRuntimeApi().iptv.testEpg(settings)
}
