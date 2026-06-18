import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
  ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  danger: 'bg-destructive text-white hover:bg-destructive/90',
}

export function Button({ className, variant = 'secondary', ...props }: ButtonProps): React.JSX.Element {
  return (
    <button
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
