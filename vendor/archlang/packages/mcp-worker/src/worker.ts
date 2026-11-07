/**
 * The Worker entry: the request handler (`app.ts`) over the assets the build inlined — the five
 * `archlang://` resources and the viewer page — because a Worker has no filesystem to read them
 * from at run time (scripts/build.mjs).
 */
import resources from "virtual:archlang-resources";
import viewerHtml from "virtual:archlang-viewer";
import { makeWorker } from "./app.js";

export default makeWorker({
  resources,
  viewerHtml,
  version: __WORKER_VERSION__,
  renderVersion: __RENDER_VERSION__,
});
