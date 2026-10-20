# Ghassla landing page

Static marketing page for `ghassla.com` (English and Arabic, one file, no build step).
It links to the ERP at `https://erp.ghassla.com` (sign in and `/signup`).

## Deploy (Vercel)

Create a separate Vercel project from this repo with **Root Directory** set to `landing`
and the framework preset **Other**. No build command or output directory is needed.
Then add `ghassla.com` and `www.ghassla.com` to that project.

This folder is independent of the ERP project: the repo-root `vercel.json` does not apply to it.

## Editing

Colours are the CSS variables at the top of `index.html` (`:root` for light, the
`prefers-color-scheme: dark` block for dark). All copy is in the `T` object in the script at the
bottom (`en` and `ar`).
