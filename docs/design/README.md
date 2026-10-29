# Design screens

Source of the four screens from the 2026-10-28 design session, as plain HTML. Each file is one artboard: open it in a browser to see the screen (the `<x-dc>` wrapper and the trailing script are harmless outside the canvas editor). They illustrate `docs/design-benefits-page.md`; the spec's numbered rules are the contract, and these files show what they add up to.

| File             | Screen                                                                                                                     | Size     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| `Main.dc.html`   | Home on a phone: "use before it expires", date-sorted across cards, with a two-item "Needs you" block                      | 390×844  |
| `Card.dc.html`   | Sapphire Reserve on a phone: enrollment checklist, one line per benefit, one row expanded, memberships group at the bottom | 390×1180 |
| `Review.dc.html` | Review on a phone: the three question types and nothing else                                                               | 390×844  |
| `Web.dc.html`    | Home on the web: the same list on the left, the selected benefit's detail on the right                                     | 1280×820 |

Colors and type come from `src/app/globals.css` tokens; the mockups inline their hex values only because they are static files. The data on the screens is the owner's real benefit set with illustrative amounts; nothing on them is a personal identifier.
