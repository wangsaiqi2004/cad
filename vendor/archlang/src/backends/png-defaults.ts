/**
 * The page width, in pixels, of a PNG meant to be LOOKED AT (on a screen, or by a model's
 * vision) when the caller names none. The native render is thousands of pixels wide; this keeps
 * the image legible and small. `archlang preview` and the MCP `compile` tool both default to it,
 * and the manifest's help states it. A module of its own, with no imports, so the manifest can
 * read it without loading the raster backend.
 */
export const PNG_PREVIEW_WIDTH = 1600;
