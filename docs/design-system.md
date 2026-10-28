# Perkkeep design system and UI audit

Reviewed 2026-10-28. This document records the tokens that govern typography, color, radius, and spacing in `src/app/globals.css`, the rules for using them, and the findings of the UI and settings audit that introduced them.

## Rules

1. Every `font-size`, `font-weight`, color, radius, shadow, and spacing value in a component rule references a token from `:root`. Literal values belong only in `:root`.
2. No interface text renders smaller than `--text-xs` (12px). The one exception is text printed on card artwork (`.face-text`: the cardholder name and last four digits). That text scales with the card in container units (`cqw`), as printing does on a physical card, so it can be smaller than 12px on a narrow card tile. The same information appears at full size elsewhere on the page.
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

| Group   | Tokens                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-surface-hover`, `--color-surface-selected`                                                                                                       |
| Lines   | `--color-border` (dividers), `--color-border-strong` (controls)                                                                                                                                                     |
| Text    | `--color-text`, `--color-text-muted` (5.2:1 or better on every neutral surface), `--color-icon-muted` (icons only)                                                                                                  |
| Brand   | `--color-accent`, `--color-accent-hover`, `--color-accent-soft`, `--color-on-accent`, `--color-on-accent-muted`, `--color-gold`, `--color-focus`                                                                    |
| Status  | `success`, `warning`, and `danger` each have `-bg` and `-text` tokens; `--color-neutral-bg` pairs with `--color-text-muted`                                                                                         |
| Art     | `--card-face-a` and `--card-face-b` (default face; each card sets `--face-a` and `--face-b` inline from `src/lib/card-faces.ts`), `--card-gold`, `--card-ring`, `--card-shadow`, `--emboss-font`, `--emboss-shadow` |

Radius tokens are `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (12px), and `--radius-full`. Spacing follows a 4px scale from `--space-1` (4px) to `--space-12` (48px).

## Audit findings, before this change

Counts come from `src/app/globals.css` at commit `d6709e0`, the base that the Neon port in `claude/gallant-cray-jewnhr` also starts from. That branch added about 170 lines of card-art and account styles in the same literal style; this change converts them to tokens.

- **Font sizes.** The stylesheet used 28 distinct font sizes. Thirty-one declarations were 6px to 9px, and 59 more were 10px or 11px. Twenty-two of the 31 smallest declarations appeared in the 760px breakpoint, which shrank text on phones instead of keeping it legible: card issuer names were 6px, section eyebrows and the summary pill were 7px, and period labels, the footer, and badges were 8px.
- **Colors.** The stylesheet contained 119 distinct hex values. Ten were defined as color variables; the rest were one-off tints of the same green, sand, and amber hues. A late override block re-set the secondary text color for 13 selectors to repair low contrast.
- **Letter spacing and line height.** Twenty-one letter-spacing values and twelve line-height values were used, all in px or unitless one-offs.
- **Focus.** Buttons and inputs used two different focus-ring colors.
- **Class collision.** The period-panel label used the class `overline`. Tailwind generated its `overline` utility for that class, so the label rendered with a line above it.

After this change, the stylesheet uses the 8 type tokens and 3 weights listed above, contains no literal colors outside `:root`, and contains no font size below 12px.

## Settings and information architecture

### Settings, before

On the Neon branch, Settings stacked six blocks at the same level, with no grouping:

- a privacy card that also held the manual reconciliation action;
- an install card;
- a "Name on your cards" form;
- a Connected accounts area containing the SimpleFIN card, a long CSV import form, and the account list;
- the reconciliation log;
- a Sign out button.

The signed-in email address appeared only in the desktop sidebar, so phone users could not see which account they were using.

### Settings, after

Settings is now a three-level hierarchy: page, section (`h2`), and grouped rows (`h3`). Lists that belong to a section, such as the accounts and the reconciliation log, sit under an `h3` sub-heading with a count.

1. **Account**
   - Signed-in email address, workspace description, and Sign out.
   - Name on your cards.
2. **Connected accounts**
   - SimpleFIN, with a status badge (Linked, Needs attention, or Not connected), Sync now, and Replace token.
   - Statement CSV, with the import form behind an "Import a statement CSV" disclosure.
   - Any other connections.
   - Accounts sub-heading, with a count and Match transactions now, followed by one row per account.
3. **Reconciliation**
   - How your data is used.
   - Manual reconciliation, with the "Record a manual reconciliation" action.
   - Reconciliation log sub-heading, with a count and a success or failed badge per run.
4. **App**
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

## Benefit rows, progress bars and alerts (2026-10-28)

Added with the Phase 2 alerts work (D45 to D47). All values reference tokens; no new literals were added outside `:root`.

- `.cadence-group` and `.cadence-group-heading`: one section per reset timeframe with a count and totals in `--text-xs`.
- `.benefit-row`: a three-column grid on desktop (title, progress, status and toggle) that collapses to two columns at 760px with the bar on its own line. The row title is an `h3` at `--text-sm`. Hints use the warning pair; coverage notes use `--color-text-muted`.
- `.progress`: an 8px track. `.progress-confirmed` fills with `--color-accent`, `.progress-candidate` is a hatched gold stripe, `.progress-time` is a 2px tick at today. `.untrusted` greys the fill with `--color-icon-muted`; `.unknown` draws a hatched empty track.
- `.benefit-row-quick`: the inline entry form. Inputs are `--text-md` so iOS does not zoom.
- `.alert-item`: a left-bordered card in warning, danger, success, accent or neutral tone with an uppercase `.alert-kind` chip, text, and an action link plus an optional dismiss button.
- `.nav-badge`: the attention count on the Review tab, drawn in `--color-warning-text` on `--color-on-accent`; on phones it sits in the corner of the tab.
