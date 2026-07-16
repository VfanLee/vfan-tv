# shadcn patches

## 2026-07-16

- Moved shadcn-generated components from `components/ui` to `ui` and updated `components.json` plus all renderer imports to use the `@/ui/*` alias.
  - Reason: keep shadcn-generated components separate from business-level public components.
  - Upgrade note: retain the `ui: "@/ui"` alias in `components.json` when adding or regenerating components.
- Applied the project's formatting rules to `ui` and disabled incompatible ESLint rules in generated component files.
  - Reason: upstream generated components omit explicit return types and export component variants, while this project enforces rules that reject both patterns.
  - Upgrade note: retain these file-level disables when regenerating the affected components.

## 2026-07-07

- Added `cursor-pointer` to the shadcn `Button` base styles, with `disabled:cursor-default`.
  - Reason: buttons should consistently show a pointer cursor while preserving disabled affordance.
  - Upgrade note: reapply this base class if the upstream `button` component is regenerated.
