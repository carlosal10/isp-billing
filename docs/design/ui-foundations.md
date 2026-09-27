# SwiftBridge UI Foundations

## Design direction

SwiftBridge should feel like a calm network operations desk: precise, fast, and trustworthy under pressure. The interface uses deep ink surfaces for navigation, a clear blue primary action, mint for healthy state, amber for attention, and red only for destructive or failed state.

The public experience sells business control. The signed-in experience helps an operator recognize state, find a subscriber, take a safe action, and confirm the result quickly.

## Information hierarchy

1. **Current state:** what is healthy, at risk, overdue, offline, or waiting.
2. **Impact:** customers, money, devices, or workflows affected.
3. **Next action:** the safest useful action available to the current role.
4. **Evidence:** last update, source, actor, request ID, gateway event, or router operation.
5. **Recovery:** retry, reconcile, roll back, escalate, or open the audit trail.

## Core visual tokens

- Ink: `#071A2F`
- Primary blue: `#175CD3`
- Primary dark: `#0B3B8C`
- Signal cyan: `#0EA5E9`
- Healthy mint: `#12B76A`
- Attention amber: `#F79009`
- Critical red: `#F04438`
- Canvas: `#F4F7FB`
- Surface: `#FFFFFF`
- Primary text: `#10243E`
- Secondary text: `#5D6B7D`
- Border: `#DCE4EE`

Use an 8-pixel spacing rhythm, 10–16 pixel surface radii, restrained shadows, and tabular numerals for money, traffic, dates, and counts.

## Component rules

- One primary action per view or dialog.
- Buttons describe outcomes: “Issue invoice,” “Suspend access,” or “Retry event.”
- Destructive actions use red only at the final decision point and require impact text.
- Status always includes text; color is supporting information.
- Tables keep identity columns visible, align numeric fields right, and move secondary details into expandable rows on narrow screens.
- Empty states explain why the area is empty and offer the next useful action.
- Loading states preserve layout and label what is being loaded.
- Errors include a recovery action and request ID when available.
- Drawers preserve list context for inspection; full pages handle multi-step work; modals remain for short, bounded decisions.

## Navigation model

- **Workspace:** dashboard, customers, plans, payments.
- **Network:** routers, PPPoE, hotspot, static IP, terminal, usage.
- **Operations:** health, NOC, service operations, support, jobs, communications.
- **Administration:** team, API keys, audit logs, integrations, settings.

Role permissions should remove unavailable sections instead of presenting repeated permission errors.

## Responsive behavior

- Mobile prioritizes search, customer identity, status, and the primary action.
- Tablet uses two-column summaries and horizontal table containment.
- Desktop provides persistent navigation and dense operational tables.
- Wide screens increase information capacity rather than stretching content indefinitely.

## Accessibility baseline

- WCAG 2.2 AA color contrast.
- Visible keyboard focus on every interactive element.
- Semantic headings, landmarks, labels, tables, and live regions.
- Minimum 44-pixel touch targets where space permits.
- No critical information encoded by color alone.
- Motion respects `prefers-reduced-motion`.
- Dialog focus is trapped and restored; Escape closes only when safe.

## Screen migration checklist

- Uses shared tokens and components.
- Has loading, empty, error, forbidden, offline, and success states.
- Works with long tenant/customer names and large numbers.
- Has one clear primary action.
- Shows last-updated or data-source context where freshness matters.
- Has keyboard and mobile evidence.
- Records or links to an audit event for consequential actions.
