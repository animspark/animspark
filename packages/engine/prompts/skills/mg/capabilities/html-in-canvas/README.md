# HTML in Canvas (desktop host only)

Turns browser-laid-out HTML into a bitmap for slicing, particles and textures. For ordinary text motion, use the DOM directly.

This capability is only available where the renderer's Chromium supports the HTML-in-Canvas API (the desktop host); on other hosts it is not installed.

When you need it, read [HTML to bitmap, with consumer examples](APIs/HtmlTexture.md). It contains a component example you can drop into a scene, the parameters, and the library's limits.

Read this API when you need to slice layout into pieces, sample it into particles, or map it onto a 3D surface. Lay out static content first, then take the bitmap; the motion happens mainly on the side that consumes the bitmap.
