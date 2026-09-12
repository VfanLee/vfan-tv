/** 检查整个 Rust crate，避免追加暂存文件路径或改写未暂存代码。 */
function checkRustFormatting() {
  return 'pnpm run format:rust:check'
}

export default {
  '*.{js,jsx,ts,tsx,mjs,cjs,json,css,md,html}': 'prettier --write',
  '*.rs': checkRustFormatting,
}
