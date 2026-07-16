import { Component, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Check, Copy, House, Sparkles } from 'lucide-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router'
import { Button } from '@/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  componentStack?: string
  error?: Error
  occurredAt?: string
}

const initialState: AppErrorBoundaryState = {}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = initialState

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, occurredAt: new Date().toISOString() }
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary captured an error.', error, info)
    this.setState({ componentStack: info.componentStack ?? undefined })
  }

  private returnHome = (): void => {
    window.location.hash = '#/'
    this.setState(initialState)
  }

  public render(): ReactNode {
    const { componentStack, error, occurredAt } = this.state

    if (error) {
      return (
        <AppErrorFallback
          componentStack={componentStack}
          error={error}
          occurredAt={occurredAt}
          onReturnHome={this.returnHome}
        />
      )
    }

    return this.props.children
  }
}

export function AppRouteErrorPage(): React.JSX.Element {
  const navigate = useNavigate()
  const routeError = useRouteError()

  return <AppErrorFallback error={normalizeError(routeError)} onReturnHome={() => navigate('/', { replace: true })} />
}

function AppErrorFallback({
  componentStack,
  error,
  occurredAt,
  onReturnHome,
}: {
  componentStack?: string
  error: Error
  occurredAt?: string
  onReturnHome: () => void
}): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const errorDetails = formatErrorDetails(error, componentStack, occurredAt)

  const copyErrorDetails = async (): Promise<void> => {
    const copied = await copyText(errorDetails)
    setCopyStatus(copied ? 'copied' : 'failed')
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Empty className="border-border bg-card max-w-lg flex-none overflow-hidden border py-14 shadow-sm">
        <EmptyHeader>
          <EmptyMedia>
            <ErrorMascot />
          </EmptyMedia>
          <EmptyTitle>哎呀，画面暂时迷路了</EmptyTitle>
          <EmptyDescription>应用遇到了一点小状况。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="sm:flex-row sm:justify-center">
          <Button variant="outline" onClick={() => void copyErrorDetails()}>
            {copyStatus === 'copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copyStatus === 'copied' ? '已复制错误信息' : copyStatus === 'failed' ? '复制失败，请重试' : '复制错误信息'}
          </Button>
          <Button onClick={onReturnHome}>
            <House data-icon="inline-start" />
            返回首页
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}

function ErrorMascot(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="relative h-24 w-28">
      <div className="bg-primary/35 absolute top-1 left-[45px] h-6 w-1 origin-bottom -rotate-30 rounded-full" />
      <div className="bg-primary/35 absolute top-1 right-[45px] h-6 w-1 origin-bottom rotate-30 rounded-full" />
      <Sparkles className="text-primary absolute -top-1 right-0 motion-safe:animate-pulse" />
      <div className="border-primary/20 bg-accent absolute inset-x-2 top-5 flex h-16 items-center justify-center rounded-3xl border shadow-sm">
        <div className="border-border bg-card flex h-11 w-16 flex-col items-center justify-center gap-2 rounded-2xl border">
          <div className="flex items-center gap-4">
            <span className="bg-primary size-2 rounded-full" />
            <span className="bg-primary size-2 rounded-full" />
          </div>
          <span className="border-primary h-1.5 w-4 rounded-b-full border-b-2" />
        </div>
        <span className="bg-primary/50 absolute right-2 size-2 rounded-full" />
      </div>
      <div className="bg-primary/25 absolute bottom-0 left-8 h-2 w-4 rounded-b-full" />
      <div className="bg-primary/25 absolute right-8 bottom-0 h-2 w-4 rounded-b-full" />
    </div>
  )
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value

  if (isRouteErrorResponse(value)) {
    const detail = typeof value.data === 'string' ? value.data : JSON.stringify(value.data)
    return new Error([`${value.status} ${value.statusText}`, detail].filter(Boolean).join(': '))
  }

  return new Error(typeof value === 'string' ? value : String(value))
}

function formatErrorDetails(error: Error, componentStack: string | undefined, occurredAt: string | undefined): string {
  const details = [
    `发生时间：${occurredAt ?? new Date().toISOString()}`,
    `页面地址：${window.location.href}`,
    `错误信息：${error.name}: ${error.message}`,
  ]

  if (error.stack) {
    details.push(`JavaScript Stack:\n${error.stack}`)
  }

  if (componentStack?.trim()) {
    details.push(`React Component Stack:\n${componentStack.trim()}`)
  }

  return details.join('\n\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()

    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      textarea.remove()
    }
  }
}
