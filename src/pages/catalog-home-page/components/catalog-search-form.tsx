import { useState } from 'react'
import { SearchBox } from '@/ui'

/** 渲染资源目录搜索表单 */
export function CatalogSearchForm({
  initialValue,
  onClear,
  onSubmit,
}: {
  initialValue: string
  onClear: () => void
  onSubmit: (value: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)

  return (
    <SearchBox
      ariaLabel="搜索当前点播源"
      placeholder="搜索当前点播源中的影片"
      value={value}
      onChange={setValue}
      onClear={() => {
        setValue('')
        onClear()
      }}
      onSubmit={() => onSubmit(value)}
    />
  )
}
