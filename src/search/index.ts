import { buildImageIndex } from "./image";
import { buildActorIndex } from "./actor";
import { buildStudioIndex } from "./studio";
import { buildMovieIndex } from "./movie";
import { buildSceneIndex } from "./scene";
import { studioCache } from "../types/studio";
import { imageCache } from "../types/image";

export async function buildIndices() {
  await buildSceneIndex();
  await buildActorIndex();
  await buildMovieIndex();
  await buildStudioIndex();
  await buildImageIndex();
  imageCache.prune();
  studioCache.prune();
}
