# Theme preferences

PagePulse provides a browser-local display preference with three options:

- **System** follows the operating system's current light or dark appearance and updates while the
  browser is open when that appearance changes.
- **Light** always uses the light token set.
- **Dark** always uses the dark token set.

On a browser's first visit, PagePulse presents a keyboard-accessible choice dialog. The selected
preference is stored under `pagepulse-theme-preference` in that browser's local storage. It is not
sent to the API or stored in the `users` table, so it intentionally remains specific to each browser.

The initial HTML applies the saved or system-resolved token set before the application loads, avoiding
a visible light-theme flash. Semantic CSS tokens cover surfaces, text, borders, accents, focus rings,
and destructive actions; all application routes receive the resolved tokens.
