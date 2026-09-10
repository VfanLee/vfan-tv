import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/ui'
import { cn } from '@/utils'

type PageItem = number | 'start-ellipsis' | 'end-ellipsis'

/** 渲染资源目录分页控件 */
export function CatalogPagination({
  currentPage,
  disabled,
  getPageHref,
  onPageChange,
  pageCount,
}: {
  currentPage: number
  disabled: boolean
  getPageHref: (page: number) => string
  onPageChange: (page: number) => void
  pageCount: number
}): React.JSX.Element {
  const pageItems = buildPageItems(currentPage, pageCount)
  return (
    <Pagination aria-label="片库分页" className="mt-10">
      <PaginationContent className="flex-wrap justify-center gap-1">
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={disabled || currentPage <= 1}
            aria-label="上一页"
            className={cn((disabled || currentPage <= 1) && 'pointer-events-none opacity-50')}
            href={getPageHref(Math.max(1, currentPage - 1))}
            size="icon-lg"
            tabIndex={disabled || currentPage <= 1 ? -1 : undefined}
            text=""
            onClick={(event) => {
              event.preventDefault()
              if (!disabled && currentPage > 1) onPageChange(currentPage - 1)
            }}
          />
        </PaginationItem>
        {pageItems.map((item) =>
          typeof item === 'number' ? (
            <PaginationItem key={item}>
              <PaginationLink
                aria-label={`第 ${item} 页`}
                href={getPageHref(item)}
                isActive={item === currentPage}
                size="icon-lg"
                onClick={(event) => {
                  event.preventDefault()
                  if (!disabled && item !== currentPage) onPageChange(item)
                }}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <PaginationEllipsis />
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            aria-disabled={disabled || currentPage >= pageCount}
            aria-label="下一页"
            className={cn((disabled || currentPage >= pageCount) && 'pointer-events-none opacity-50')}
            href={getPageHref(Math.min(pageCount, currentPage + 1))}
            size="icon-lg"
            tabIndex={disabled || currentPage >= pageCount ? -1 : undefined}
            text=""
            onClick={(event) => {
              event.preventDefault()
              if (!disabled && currentPage < pageCount) onPageChange(currentPage + 1)
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

/** 生成包含页码和省略号的分页按钮序列 */
function buildPageItems(currentPage: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'end-ellipsis', pageCount]
  if (currentPage >= pageCount - 3) {
    return [1, 'start-ellipsis', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  }
  return [1, 'start-ellipsis', currentPage - 1, currentPage, currentPage + 1, 'end-ellipsis', pageCount]
}
