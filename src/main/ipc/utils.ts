export function isZodError(
  error: unknown,
): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return typeof error === 'object' && error !== null && Array.isArray((error as { issues?: unknown }).issues)
}

export function formatZodError(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '根节点'}: ${issue.message}`)
    .join('；')
}
