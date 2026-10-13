# YMIND interaction contract

Canonical UI Map:

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native select in Inspector and task dialog | DESIGN.md | native OS popup accepted | keyboard and popup |
| Date | TaskDialog native date input | domain.ts | native OS calendar accepted; stored ISO date | keyboard and date validation |
| Form | Field in src/ui.tsx | domain.ts | editor | import validation |
| Scrollbar | Global src/styles.css | DESIGN.md | global | computed style |
| Toast | Toast in src/ui.tsx | App status | live region | save/export/error |
| CRUD | model.ts and App reducer | domain.ts | workbook/sheet/topic | core tests + browser |

Persistence is browser-local and versioned. Autosave failure is visible; export remains available. Import is atomic and never overwrites the current workbook on invalid input. Per-edit undo history includes the whole current workbook, bounded to 80 entries. File outputs are initiated by the user. File generation failures show a status; destination and disk-write feedback belong to the browser or OS. Search is transient and workbook-local, so its query is not placed in a shareable URL.

Topic edit: double click or F2, Enter commits, Escape cancels, IME composition prevents premature commit. Tab adds child; Enter adds sibling; Delete removes a selected branch and is undoable; Ctrl+Z and Ctrl+Shift+Z undo/redo. Root cannot be removed. Collapse keeps descendants intact. Move destinations cannot be inside their own subtree.

Modal has role dialog, accessible title, focus trap, Escape close, focus return. No browser alert/confirm/prompt. Popup dismisses by Escape or outside click and receives keyboard focus. Search does local filtering with a clear button and no IME shortcut handling.

Persistence writes compare a random revision token in the same IndexedDB transaction. A stale window gets a visible save error and retains its in-memory document for export; it cannot overwrite the newer window. Invalid stored documents pause writes rather than overwriting the original record. Undo retains at most 80 snapshots and approximately 64 MB, keeping at least the latest snapshot for large documents.

AI and live cloud collaboration remain external capabilities pending provider/service configuration; no fake network success. Version-history snapshots are local, not collaborative version history.
