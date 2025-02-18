import { getConfig } from "../config";
import { imageCollection, studioCollection } from "../database";
import { extractFields, extractStudios } from "../extractor";
import { downloadFile } from "../ffmpeg-download";
import * as logger from "../logger";
import { runPluginsSerial } from "../plugins";
import { indexImages } from "../search/image";
import { indexStudios } from "../search/studio";
import Image from "../types/image";
import Movie from "../types/movie";
import Studio from "../types/studio";
import { extensionFromUrl, libraryPath, validRating } from "../types/utility";

// This function has side effects
export async function onMovieCreate(movie: Movie, event = "movieCreated"): Promise<Movie> {
  const config = getConfig();

  const pluginResult = await runPluginsSerial(config, event, {
    movie: JSON.parse(JSON.stringify(movie)) as Movie,
    movieName: movie.name,
    $createLocalImage: async (path: string, name: string, thumbnail?: boolean) => {
      logger.log("Creating image from " + path);
      const img = new Image(name);
      if (thumbnail) img.name += " (thumbnail)";
      img.path = path;
      logger.log("Created image " + img._id);
      // await database.insert(database.store.images, img);
      await imageCollection.upsert(img._id, img);
      if (!thumbnail) {
        await indexImages([img]);
      }
      return img._id;
    },
    $createImage: async (url: string, name: string, thumbnail?: boolean) => {
      // if (!isValidUrl(url)) throw new Error(`Invalid URL: ` + url);
      logger.log("Creating image from " + url);
      const img = new Image(name);
      if (thumbnail) img.name += " (thumbnail)";
      const ext = extensionFromUrl(url);
      const path = libraryPath(`images/${img._id}${ext}`);
      await downloadFile(url, path);
      img.path = path;
      logger.log("Created image " + img._id);
      // await database.insert(database.store.images, img);
      await imageCollection.upsert(img._id, img);
      if (!thumbnail) {
        await indexImages([img]);
      }
      return img._id;
    },
  });

  if (
    typeof pluginResult.frontCover === "string" &&
    pluginResult.frontCover.startsWith("im_") &&
    (!movie.frontCover || config.ALLOW_PLUGINS_OVERWRITE_MOVIE_THUMBNAILS)
  )
    movie.frontCover = pluginResult.frontCover;

  if (
    typeof pluginResult.backCover === "string" &&
    pluginResult.backCover.startsWith("im_") &&
    (!movie.backCover || config.ALLOW_PLUGINS_OVERWRITE_MOVIE_THUMBNAILS)
  )
    movie.backCover = pluginResult.backCover;

  if (
    typeof pluginResult.spineCover === "string" &&
    pluginResult.spineCover.startsWith("im_") &&
    (!movie.spineCover || config.ALLOW_PLUGINS_OVERWRITE_MOVIE_THUMBNAILS)
  )
    movie.spineCover = pluginResult.spineCover;

  if (typeof pluginResult.name === "string") movie.name = pluginResult.name;

  if (typeof pluginResult.description === "string") movie.description = pluginResult.description;

  if (typeof pluginResult.releaseDate === "number")
    movie.releaseDate = new Date(pluginResult.releaseDate).valueOf();

  if (validRating(pluginResult.rating)) movie.rating = pluginResult.rating;

  if (typeof pluginResult.favorite === "boolean") movie.favorite = pluginResult.favorite;

  if (typeof pluginResult.bookmark === "number") movie.bookmark = pluginResult.bookmark;

  if (pluginResult.custom && typeof pluginResult.custom === "object") {
    for (const key in pluginResult.custom) {
      const fields = await extractFields(key);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      if (fields.length) movie.customFields[fields[0]] = pluginResult.custom[key];
    }
  }

  if (!movie.studio && pluginResult.studio && typeof pluginResult.studio === "string") {
    const studioId = (await extractStudios(pluginResult.studio))[0];

    if (studioId) movie.studio = studioId;
    else if (config.CREATE_MISSING_STUDIOS) {
      const studio = new Studio(pluginResult.studio);
      movie.studio = studio._id;
      await studioCollection.upsert(studio._id, studio);
      await indexStudios([studio]);
      logger.log("Created studio " + studio.name);
    }
  }

  return movie;
}
