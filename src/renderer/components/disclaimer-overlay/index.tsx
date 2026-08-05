import { useState } from 'react'
import { DISCLAIMER_SKIP_STORAGE_KEY } from '@shared/constants'
import { quitApp } from '@renderer/platform/api'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'

const NOTICE_ITEMS = [
  '本软件系影视聚合客户端（空壳），不提供、不内置、不运营任何点播源、直播源或视听内容；全部数据源与播放内容均由用户自行获取、配置与使用。',
  '本软件仅供个人学习与研究目的使用；禁止用于任何商业用途，禁止基于本软件对外提供公开服务、运营平台或有偿服务。',
  '用户对其自行收集、配置、访问或传播的数据与内容，以及由此产生的全部使用行为，独立承担法律责任；因公开分享、传播、运营或违法使用所引发的法律后果，均由用户自行负责，与项目作者及贡献者无关。',
  '用户应遵守其所在国家或地区的法律法规，确保自身使用行为合法，并请低调使用，避免不当传播与宣传。',
  '未经书面授权，不得在哔哩哔哩、小红书、微信公众号、抖音、今日头条及其他中国大陆社交平台以视频、图文等方式宣传本项目；亦不得以「科技周刊 / 月刊」或其他媒体、站点形式收录、转载或推广本项目。',
  '本项目不向任何国家或地区提供运营性服务、内容分发服务或技术托管服务；任何第三方在当地的使用或对外提供服务，均属其个人或该第三方行为，相关法律风险与责任由其自行承担。',
] as const

export function shouldSkipDisclaimer(): boolean {
  try {
    return window.localStorage.getItem(DISCLAIMER_SKIP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

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
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm sm:p-6">
      <div
        aria-describedby="disclaimer-description"
        aria-labelledby="disclaimer-title"
        aria-modal="true"
        className="border-border bg-card text-card-foreground flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-lg sm:max-h-[calc(100dvh-3rem)]"
        role="dialog"
      >
        <div className="bg-card relative z-10 shrink-0 px-6 py-5 shadow-[0_1px_0_0_oklch(0_0_0/0.04),0_3px_8px_-4px_oklch(0_0_0/0.08)] sm:px-8 sm:py-6 dark:shadow-[0_1px_0_0_oklch(1_0_0/0.06),0_4px_10px_-6px_oklch(0_0_0/0.35)]">
          <div className="flex items-start gap-4">
            <img alt="" className="size-16 shrink-0 sm:size-20" draggable={false} src={logoMarkUrl} />
            <div className="min-w-0 pt-0.5">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" id="disclaimer-title">
                免责声明
              </h1>
              <p className="text-muted-foreground mt-1.5 text-sm leading-6" id="disclaimer-description">
                在使用本软件前，请仔细阅读并确认下列条款。点击「我已知晓」即视为您已知悉并接受。
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
          <ul className="text-muted-foreground flex flex-col gap-3 text-sm leading-6">
            {NOTICE_ITEMS.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-primary mt-2 size-1.5 shrink-0 rounded-full bg-current" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card relative z-10 shrink-0 px-6 py-5 shadow-[0_-1px_0_0_oklch(0_0_0/0.04),0_-3px_8px_-4px_oklch(0_0_0/0.08)] sm:px-8 sm:py-6 dark:shadow-[0_-1px_0_0_oklch(1_0_0/0.06),0_-4px_10px_-6px_oklch(0_0_0/0.35)]">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={skipNextTime} onCheckedChange={(checked) => setSkipNextTime(checked === true)} />
            <span>下次不再提示</span>
          </label>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => void quitApp()}>
              拒绝
            </Button>
            <Button onClick={handleAcknowledge}>我已知晓</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
