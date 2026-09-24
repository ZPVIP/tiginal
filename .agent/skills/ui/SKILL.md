---
name: ui
description: Design or modify Tiginal user interfaces while preserving the project's established navigation, control, spacing, and feedback patterns.
---

# Tiginal UI

Reuse existing components and nearby product patterns before creating new visual treatments.

## Tabs

Use `src/renderer/components/Shared/HorizontalTabs.tsx` for horizontal tabs inside a Settings page. It must match the segmented controls used by System Prompts for Default and Custom and by Tools for Tool Categories and Tools:

- Put the tab row inside a full-width surface container with a one-pixel border, one spacing unit of padding, and large rounded corners.
- Give every tab equal width. Center its label and optional icon.
- Use a primary background, primary foreground text, and a small shadow for the active tab.
- Use secondary text for inactive tabs. On hover, use the light surface background and main text color.
- Give each tab medium rounded corners, compact vertical padding, and no underline.
- Keep the row from shrinking inside flex page layouts.
- Use semantic `tablist`, `tab`, `aria-selected`, and `tabpanel` roles.

Use `src/renderer/components/ui/Tabs.tsx` for the vertical Settings sidebar. The Profile editor modal uses a different underline treatment and is not the reference for Settings page tabs. Do not copy either tab implementation into a feature component.

## Shared view controls

Place reusable view-only controls in `src/renderer/components/Shared`. Use `InfoTooltip.tsx` for inline explanations instead of drawing another information icon or implementing a one-off tooltip.

## Product consistency

- Match field heights, borders, colors, and typography used by adjacent Settings pages.
- Keep status and validation close to the control that produced them.
- Use plain English labels and descriptions.
- Verify new UI in a running renderer at the target window size. A successful TypeScript build alone does not validate layout.
