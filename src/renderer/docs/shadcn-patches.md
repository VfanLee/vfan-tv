# shadcn patches

## 2026-07-16

- Moved shadcn-generated components from `components/ui` to `ui` and updated `components.json` plus all renderer imports to use the `@/ui/*` alias.
  - Reason: keep shadcn-generated components separate from business-level public components.
  - Upgrade note: retain the `ui: "@/ui"` alias in `components.json` when adding or regenerating components.
- Updated alert-dialog, alert, badge, button, card, empty, input, select, skeleton and switch with the latest shadcn CLI output.
  - Upgrade note: generated components retain the `@/utils/cn` import configured by `components.json`; business code continues to use `@/utils`.
- Moved the Button pointer cursor behavior from generated component source to `styles/custom.css`.
  - Reason: preserve the project interaction style without maintaining a fork of the generated Button component.

## 2026-07-07

- Added `cursor-pointer` to the shadcn `Button` base styles, with `disabled:cursor-default`.
  - Reason: buttons should consistently show a pointer cursor while preserving disabled affordance.
  - Upgrade note: reapply this base class if the upstream `button` component is regenerated.
