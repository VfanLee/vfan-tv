import { useState, type JSX, type ReactNode } from 'react'
import { cn } from '@renderer/utils/cn'
import type { CustomOptionsInput, CustomSliderInput, DisplaySettingsState } from '../types'

interface SettingsSurfaceProps {
  bottomOffset: number
  children: ReactNode
  closing: boolean
  className: string
}

function SettingsSurface({ bottomOffset, children, closing, className }: SettingsSurfaceProps): JSX.Element {
  return (
    <section
      data-display-settings
      style={{ bottom: bottomOffset }}
      className={cn(
        'absolute right-4 z-[200] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-sm transition-all duration-150 select-none',
        className,
        closing && 'translate-y-1 opacity-0',
      )}
      onCopy={(event) => event.preventDefault()}
    >
      {children}
    </section>
  )
}

export function DisplaySettingsMenu({
  state,
  closing,
  bottomOffset,
}: {
  state: DisplaySettingsState
  closing: boolean
  bottomOffset: number
}): JSX.Element {
  return (
    <SettingsSurface bottomOffset={bottomOffset} closing={closing} className="w-80 p-2">
      <DisplaySettingRow label="画面比例" value={formatAspectRatio(state.aspectRatio)} onClick={state.onAspectRatio} />
      <DisplaySettingRow label="画面翻转" value={formatFlip(state.flip)} onClick={state.onFlip} />
      {state.quality ? (
        <DisplaySettingRow label="画质" value={state.quality.label} onClick={state.quality.onClick} />
      ) : null}
      {state.audioTrack ? (
        <DisplaySettingRow label="音效" value={state.audioTrack.label} onClick={state.audioTrack.onClick} />
      ) : null}
      {state.showPlaybackSettings ? (
        <>
          <DisplaySettingRow label="播放速度" value={`${state.playbackRate}倍`} onClick={state.onPlaybackRate} />
          <DisplaySettingRow label="跳转步长" value={`${state.seekStep} 秒`} onClick={state.onSeekStep} />
          <DisplaySettingRow
            label="循环播放"
            value={state.loop ? '开启' : '关闭'}
            toggle={state.loop}
            onClick={state.onLoop}
          />
        </>
      ) : null}
      {state.showAutoNext ? (
        <DisplaySettingRow
          label="自动续播"
          value={state.autoNext ? '开启' : '关闭'}
          toggle={state.autoNext}
          onClick={state.onAutoNext}
        />
      ) : null}
    </SettingsSurface>
  )
}

function DisplaySettingRow({
  label,
  value,
  toggle,
  onClick,
}: {
  label: string
  value: string
  toggle?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-white/10"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{label}</span>
      <span className="w-16 text-right text-sm text-white/65">{value}</span>
      {toggle === undefined ? (
        <svg
          className="size-5 shrink-0 text-white/75"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      ) : (
        <span className={cn('h-5 w-9 shrink-0 rounded-full p-0.5', toggle ? 'bg-white' : 'bg-white/30')}>
          <span
            className={cn(
              'block size-4 rounded-full transition-transform',
              toggle ? 'translate-x-4 bg-zinc-900' : 'bg-white/80',
            )}
          />
        </span>
      )}
    </button>
  )
}

export function CustomSliderDialog({
  input,
  closing,
  onBack,
  bottomOffset,
}: {
  input: CustomSliderInput
  closing: boolean
  onBack: () => void
  bottomOffset: number
}): JSX.Element {
  const [value, setValue] = useState(input.initialValue)
  const updateValue = (nextValue: number): void => {
    const normalized = Math.min(input.max, Math.max(input.min, Number(nextValue.toFixed(2))))
    setValue(normalized)
    input.onChange(normalized)
  }

  return (
    <SettingsSurface bottomOffset={bottomOffset} closing={closing} className="w-96">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
        <button
          type="button"
          aria-label="返回显示设置"
          className="-ml-2 flex size-8 items-center justify-center rounded-full text-white hover:bg-white/10"
          onClick={onBack}
        >
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h2 className="text-base font-semibold text-white">{input.title}</h2>
      </header>
      <div className="px-5 py-8">
        <div className="text-center text-2xl font-semibold tracking-tight text-white">{input.formatValue(value)}</div>
        <div className="mt-7 flex items-center gap-4">
          <button
            type="button"
            aria-label="减小"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            onClick={() => updateValue(value - input.step)}
          >
            −
          </button>
          <input
            aria-label={input.title}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-white"
            min={input.min}
            max={input.max}
            step={input.step}
            type="range"
            value={value}
            onChange={(event) => updateValue(Number(event.target.value))}
          />
          <button
            type="button"
            aria-label="增大"
            className="flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            onClick={() => updateValue(value + input.step)}
          >
            +
          </button>
        </div>
        <div className="mt-7 flex gap-2">
          {input.presets.map((preset) => (
            <div key={preset} className="min-w-0 flex-1 text-center">
              <button
                type="button"
                className={cn(
                  'w-full rounded-full px-2 py-2 text-sm font-medium transition-colors',
                  Math.abs(value - preset) < input.step / 2
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20',
                )}
                onClick={() => updateValue(preset)}
              >
                {formatPresetNumber(preset)}
              </button>
              {preset === input.normalPreset ? <div className="mt-1.5 text-xs text-white/65">正常</div> : null}
            </div>
          ))}
        </div>
      </div>
    </SettingsSurface>
  )
}

export function CustomOptionsDialog({
  input,
  closing,
  onBack,
  bottomOffset,
}: {
  input: CustomOptionsInput
  closing: boolean
  onBack: () => void
  bottomOffset: number
}): JSX.Element {
  const [value, setValue] = useState(input.selectedValue)

  return (
    <SettingsSurface bottomOffset={bottomOffset} closing={closing} className="w-80 p-2">
      <header className="flex items-center gap-3 border-b border-white/10 px-2 py-2.5">
        <button
          type="button"
          aria-label="返回显示设置"
          className="flex size-8 items-center justify-center rounded-full text-white hover:bg-white/10"
          onClick={onBack}
        >
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h2 className="text-base font-semibold text-white">{input.title}</h2>
      </header>
      <div className="py-1">
        {input.options.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                'flex h-11 w-full items-center px-3 text-left text-sm transition-colors hover:bg-white/10',
                selected && 'bg-white/10 text-white',
              )}
              onClick={() => {
                setValue(option.value)
                input.onChange(option.value)
              }}
            >
              <span className="flex-1">{option.label}</span>
              {selected ? (
                <span className="text-base" aria-label="已选择">
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </SettingsSurface>
  )
}

function formatAspectRatio(value: string): string {
  return value === 'default' ? '默认' : value
}

function formatFlip(value: string): string {
  return { normal: '正常', horizontal: '水平', vertical: '垂直' }[value] ?? value
}

function formatPresetNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
