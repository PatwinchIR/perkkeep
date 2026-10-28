# Perkkeep design system and UI audit

Reviewed 2026-10-28. This document records the tokens that govern typography, color, radius, and spacing in `src/app/globals.css`, the rules for using them, and the findings of the UI and settings audit that introduced them.

## Rules

1. Every `font-size`, `font-weight`, color, radius, shadow, and spacing value in a component rule references a token from `:root`. Literal values belong only in `:root`.
2. No text renders smaller than `--text-xs` (12px).
3. Breakpoints change layout and spacing, not type size. The one exception is `h1`, which steps from `--text-3xl` to `--text-2xl` at 760px and below.
4. Uppercase labels use the `.eyebrow` role. Do not create a class named `overline`, `underline`, or any other Tailwind utility name, because Tailwind generates a utility for every class name it finds in `src` and the two rules will collide.
5. Status colors are used only as the background and text pairs listed below. Each pair has a contrast ratio of 5:1 or better.

## Type scale

| Token        | Size | Role                                                             |
| ------------ | ---- | ---------------------------------------------------------------- |
| `--text-xs`  | 12px | Uppercase labels, metadata, timestamps, badges, counts, footer   |
| `--text-sm`  | 14px | Body copy (the `body` default), buttons, nav, form labels, notes |
| `--text-md`  | 16px | Page descriptions, form inputs (prevents iOS zoom), row titles   |
| `--text-lg`  | 18px | `h3`, card names, empty-state titles                             |
| `--text-xl`  | 22px | `h2`, dialog titles, wordmark, period figures                    |
| `--text-2xl` | 28px | Summary figures, `h1` on phones                                  |
| `--text-3xl` | 36px | `h1`                                                             |
| `--text-4xl` | 48px | Hero figure on the overview, welcome headline                    |

Weights: `--weight-regular` (400) for figures and display text, `--weight-medium` (500) for headings, `--weight-semibold` (600) for emphasis, buttons, and labels. Line heights: `--leading-tight` (1.15) for 28px and above, `--leading-snug` (1.3) for headings and controls, `--leading-normal` (1.5) for body copy, `--leading-relaxed` (1.65) for long supporting text. Letter spacing is expressed in `em` so that it scales with size: `--tracking-display`, `--tracking-tight`, and `--tracking-caps`. Money figures use `font-variant-numeric: tabular-nums`.

## Color tokens

| Group   | Tokens                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Neutral | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-surface-hover`, `--color-surface-selected`                                    |
| Lines   | `--color-border` (dividers), `--color-border-strong` (controls)                                                                                  |
| Text    | `--color-text`, `--color-text-muted` (5.2:1 or better on every neutral surface), `--color-icon-muted` (icons only)                               |
| Brand   | `--color-accent`, `--color-accent-hover`, `--color-accent-soft`, `--color-on-accent`, `--color-on-accent-muted`, `--color-gold`, `--color-focus` |
| Status  | `success`, `warning`, and `danger` each have `-bg` and `-text` tokens; `--color-neutral-bg` pairs with `--color-text-muted`                      |
| Art     | `--card-amex`, `--card-chase`, `--card-discover` and their `-text` tokens, `--card-ring`                                                         |

Radius tokens are `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (12px), and `--radius-full`. Spacing follows a 4px scale from `--space-1` (4px) to `--space-12` (48px).

## Audit findings, before this change

Counts come from `src/app/globals.css` at commit `d6709e0`.

- **Font sizes.** The stylesheet used 28 distinct font sizes. Thirty-one declarations were 6px to 9px, and 59 more were 10px or 11px. Twenty-two of the 31 smallest declarations appeared in the 760px breakpoint, which shrank text on phones instead of keeping it legible: card issuer names were 6px, section eyebrows and the summary pill were 7px, and period labels, the footer, and badges were 8px.
- **Colors.** The stylesheet contained 119 distinct hex values. Ten were defined as color variables; the rest were one-off tints of the same green, sand, and amber hues. A late override block re-set the secondary text color for 13 selectors to repair low contrast.
- **Letter spacing and line height.** Twenty-one letter-spacing values and twelve line-height values were used, all in px or unitless one-offs.
- **Focus.** Buttons and inputs used two different focus-ring colors.
- **Class collision.** The period-panel label used the class `overline`. Tailwind generated its `overline` utility for that class, so the label rendered with a line above it.

After this change, the stylesheet uses the 8 type tokens and 3 weights listed above, contains no literal colors outside `:root`, and contains no font size below 12px.

## Settings and information architecture

### Settings, before

Settings showed two peer cards with unrelated content. The first card mixed a privacy statement, a status badge, the manual reconciliation action, and a note about the Refresh button. The second card held install steps and an offline note. The reconciliation log and the Sign out button followed as unlabeled siblings. The signed-in email address was visible only in the desktop sidebar, so phone users could not see which account they were using.

### Settings, after

Settings is now a three-level hierarchy: page, section (`h2`), and grouped rows, with the reconciliation log as a sub-heading (`h3`) inside its section.

1. **Account**: signed-in email address, workspace description, and Sign out.
2. **Data & reconciliation**
   - Data source: private Supabase ledger; bank transactions are not fetched.
   - Automatic reconciliation: not verified; coverage is recorded manually.
   - Manual reconciliation: description and the "Record a manual reconciliation" action.
   - Reconciliation log, with a count and success or failed badges per run.
3. **App**
   - Add to Home Screen (anchor `#install`, linked from the sidebar).
   - Offline behavior.

### History, before and after

The History page placed its view switch (Periods, Evidence ledger, Change log) in the same row as its two filters, as a third dropdown. The view switch changes what the page shows, while the filters narrow it, so the two controls sit at different levels. The view switch is now a segmented control above the filters, and the end-to-end test selects views by button name.

### Further recommendations, not implemented

These items are observations for a later change. They were left out to keep this change limited to styling and settings structure.

- The overview links to `/review` from four places: the heading action, both attention-strip rows, and "See review queue". The attention-strip rows could open the review queue pre-filtered to expiring items or to items that need a closer look.
- "Record a manual reconciliation" is an operational task, but the action exists only in Settings. The review queue is a natural second entry point, because stale coverage is one of the reasons an item appears there.
- "Open a period for an earlier date" lives at the bottom of each card page. It is a history task and could also be reached from History.
- Eyebrow text is typed in uppercase in the JSX. The `.eyebrow` role now applies `text-transform: uppercase`, so the source strings could be written in sentence case. Some screen readers spell out all-caps words letter by letter.
- `--color-border-strong` reaches 1.56:1 against `--color-surface`. WCAG 2.1 success criterion 1.4.11 asks for 3:1 when a border is the only visual cue for a control. The previous input border had the same contrast, so this change does not regress it, but a darker control border would meet the criterion.
