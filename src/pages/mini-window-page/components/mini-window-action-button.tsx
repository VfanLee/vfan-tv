export interface MiniWindowActionButtonProps {
  disabled?: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}

/** 渲染迷你窗口操作按钮 */
export function MiniWindowActionButton({
  disabled = false,
  label,
  children,
  onClick,
}: MiniWindowActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      className="flex size-[clamp(26px,8vw,34px)] items-center justify-center rounded-[clamp(8px,2.5vw,12px)] bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-wait disabled:opacity-55 [&_svg]:size-[clamp(13px,4vw,18px)]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
