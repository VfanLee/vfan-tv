import { useState } from 'react'
import { DISCLAIMER_SKIP_STORAGE_KEY } from '@shared/constants'
import { quitApp } from '@renderer/platform/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Checkbox } from '@/ui/checkbox'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'

const NOTICE_ITEMS = [
  '本软件系影视聚合客户端（空壳），不提供、不内置、不运营任何 VOD 源、IPTV 源或视听内容；全部数据源与播放内容均由用户自行获取、配置与使用。',
  '本软件仅供个人学习与研究目的使用；禁止用于任何商业用途，禁止基于本软件对外提供公开服务、运营平台或有偿服务。',
  '用户对其自行收集、配置、访问或传播的数据与内容，以及由此产生的全部使用行为，独立承担法律责任；因公开分享、传播、运营或违法使用所引发的法律后果，均由用户自行负责，与项目作者及贡献者无关。',
  '用户应遵守其所在国家或地区的法律法规，确保自身使用行为合法，并请低调使用，避免不当传播与宣传。',
  '未经书面授权，不得在哔哩哔哩、小红书、微信公众号、抖音、今日头条及其他中国大陆社交平台以视频、图文等方式宣传本项目；亦不得以「科技周刊 / 月刊」或其他媒体、站点形式收录、转载或推广本项目。',
  '本项目不向任何国家或地区提供运营性服务、内容分发服务或技术托管服务；任何第三方在当地的使用或对外提供服务，均属其个人或该第三方行为，相关法律风险与责任由其自行承担。',
] as const

export function DisclaimerOverlay({ onAcknowledge }: { onAcknowledge: () => void }): React.JSX.Element {
  const [skipNextTime, setSkipNextTime] = useState(false)

  const handleAcknowledge = (): void => {
    if (skipNextTime) {
      try {
        window.localStorage.setItem(DISCLAIMER_SKIP_STORAGE_KEY, '1')
      } catch {
        // localStorage 不可用时仍允许进入应用。
      }
    }
    onAcknowledge()
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-3rem)]">
        <AlertDialogHeader className="block px-6 py-5 text-left sm:px-8 sm:py-6">
          <div className="flex items-start gap-4">
            <img alt="" className="size-16 shrink-0 sm:size-20" draggable={false} src={logoMarkUrl} />
            <div className="min-w-0 pt-0.5">
              <AlertDialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">免责声明</AlertDialogTitle>
              <AlertDialogDescription className="mt-1.5 text-left leading-6 text-pretty">
                在使用本软件前，请仔细阅读并确认下列条款。点击「我已知晓」即视为您已知悉并接受。
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="border-border min-h-0 flex-1 overflow-y-auto border-y px-6 py-5 sm:px-8 sm:py-6">
          <ul className="text-muted-foreground flex flex-col gap-3 text-sm leading-6">
            {NOTICE_ITEMS.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-primary mt-2 size-1.5 shrink-0 rounded-full bg-current" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 px-6 py-5 sm:px-8 sm:py-6">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={skipNextTime} onCheckedChange={(checked) => setSkipNextTime(checked === true)} />
            <span>下次不再提示</span>
          </label>
          <AlertDialogFooter className="mx-0 mt-4 mb-0 border-0 bg-transparent p-0">
            <AlertDialogCancel onClick={() => void quitApp()}>拒绝</AlertDialogCancel>
            <AlertDialogAction onClick={handleAcknowledge}>我已知晓</AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
