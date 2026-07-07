# shadcn patches

## 2026-07-07

- Changed shadcn utility imports from `@/lib/utils` to `@/utils/cn`.
  - Reason: keep the shadcn `cn` helper separate from renderer business utilities.
  - Upgrade note: when regenerating or updating shadcn components, keep `components.json` `aliases.utils` set to `@/utils/cn` and update generated imports if needed.
- Added `cursor-pointer` to the shadcn `Button` base styles, with `disabled:cursor-default`.
  - Reason: buttons should consistently show a pointer cursor while preserving disabled affordance.
  - Upgrade note: reapply this base class if the upstream `button` component is regenerated.
