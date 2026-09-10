import { Network } from 'lucide-react'

/** 渲染区块标题 */
export function SectionHeading({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof Network
  title: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="text-primary flex size-7 shrink-0 items-center justify-center">
        <Icon className="size-4" />
      </span>
      <div>
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </div>
  )
}
