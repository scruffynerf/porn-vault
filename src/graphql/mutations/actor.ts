import { getConfig } from "../../config/index";
import { actorCollection } from "../../database";
import { isMatchingItem, isSingleWord } from "../../extractor";
import * as logger from "../../logger";
import { onActorCreate } from "../../plugin_events/actor";
import { index as actorIndex, indexActors, updateActors } from "../../search/actor";
import { updateScenes } from "../../search/scene";
import Actor from "../../types/actor";
import ActorReference from "../../types/actor_reference";
import { isValidCountryCode } from "../../types/countries";
import LabelledItem from "../../types/labelled_item";
import Scene from "../../types/scene";
import { Dictionary } from "../../types/utility";

type IActorUpdateOpts = Partial<{
  name: string;
  description: string;
  rating: number;
  labels: string[];
  aliases: string[];
  avatar: string;
  thumbnail: string;
  altThumbnail: string;
  hero: string;
  favorite: boolean;
  bookmark: number | null;
  bornOn: number;
  customFields: Dictionary<string[] | boolean | string | null>;
  nationality: string | null;
}>;

async function runActorPlugins(ids: string[]) {
  const updatedActors = [] as Actor[];
  for (const id of ids) {
    let actor = await Actor.getById(id);

    if (actor) {
      logger.message(`Running plugin action event for '${actor.name}'...`);

      const labels = (await Actor.getLabels(actor)).map((l) => l._id);
      actor = await onActorCreate(actor, labels, "actorCustom");

      await Actor.setLabels(actor, labels);
      await actorCollection.upsert(actor._id, actor);

      updatedActors.push(actor);
    } else {
      logger.warn(`Actor ${id} not found`);
    }

    await updateActors(updatedActors);
  }
  return updatedActors;
}

export default {
  async runAllActorPlugins(): Promise<Actor[]> {
    const ids = (await Actor.getAll()).map((a) => a._id);
    return runActorPlugins(ids);
  },

  async runActorPlugins(_: unknown, { ids }: { ids: string[] }): Promise<Actor[]> {
    return runActorPlugins(ids);
  },

  async addActor(
    _: unknown,
    args: { name: string; aliases?: string[]; labels?: string[] }
  ): Promise<Actor> {
    let actor = new Actor(args.name, args.aliases);
    const config = getConfig();

    let actorLabels = [] as string[];
    if (args.labels) {
      actorLabels = args.labels;
    }

    try {
      actor = await onActorCreate(actor, actorLabels);
    } catch (error) {
      logger.error(error);
    }

    await Actor.setLabels(actor, actorLabels);
    await actorCollection.upsert(actor._id, actor);

    if (isSingleWord(actor.name)) {
      // Skip
    } else {
      for (const scene of await Scene.getAll()) {
        if (isMatchingItem(scene.path || scene.name, actor, true)) {
          if (config.APPLY_ACTOR_LABELS === true) {
            const sceneLabels = (await Scene.getLabels(scene)).map((l) => l._id);
            await Scene.setLabels(scene, sceneLabels.concat(actorLabels));
            logger.log(`Applied actor labels of new actor to ${scene._id}`);
          }
          await Scene.setActors(
            scene,
            (await Scene.getActors(scene)).map((l) => l._id).concat(actor._id)
          );
          try {
            await updateScenes([scene]);
          } catch (error) {
            logger.error(error);
          }
          logger.log(`Updated actors of ${scene._id}`);
        }
      }

      /* for (const image of await Image.getAll()) {
        if (isBlacklisted(image.name)) continue;
        if (isMatchingItem(image.name, actor, true)) {
          if (config.APPLY_ACTOR_LABELS === true) {
            const imageLabels = (await Image.getLabels(image)).map((l) => l._id);
            await Image.setLabels(image, imageLabels.concat(actorLabels));
            logger.log(`Applied actor labels of new actor to ${image._id}`);
          }
          await Image.setActors(
            image,
            (await Image.getActors(image)).map((l) => l._id).concat(actor._id)
          );
          try {
            await updateImages([image]);
          } catch (error) {
            logger.error(error.message);
          }
          logger.log(`Updated actors of ${image._id}`);
        }
      } */
    }

    await indexActors([actor]);
    return actor;
  },

  async updateActors(
    _: unknown,
    { ids, opts }: { ids: string[]; opts: IActorUpdateOpts }
  ): Promise<Actor[]> {
    const updatedActors = [] as Actor[];

    for (const id of ids) {
      const actor = await Actor.getById(id);

      if (actor) {
        if (Array.isArray(opts.aliases)) actor.aliases = [...new Set(opts.aliases)];

        if (Array.isArray(opts.labels)) await Actor.setLabels(actor, opts.labels);

        if (typeof opts.nationality !== undefined) {
          if (typeof opts.nationality === "string" && isValidCountryCode(opts.nationality)) {
            actor.nationality = opts.nationality;
          } else if (opts.nationality === null) {
            actor.nationality = opts.nationality;
          }
        }

        if (typeof opts.bookmark === "number" || opts.bookmark === null)
          actor.bookmark = opts.bookmark;

        if (typeof opts.favorite === "boolean") actor.favorite = opts.favorite;

        if (typeof opts.name === "string") actor.name = opts.name.trim();

        if (typeof opts.description === "string") actor.description = opts.description.trim();

        if (typeof opts.avatar === "string" || opts.avatar === null) actor.avatar = opts.avatar;

        if (typeof opts.thumbnail === "string" || opts.thumbnail === null)
          actor.thumbnail = opts.thumbnail;

        if (typeof opts.altThumbnail === "string" || opts.altThumbnail === null)
          actor.altThumbnail = opts.altThumbnail;

        if (typeof opts.hero === "string" || opts.hero === null) actor.hero = opts.hero;

        if (typeof opts.rating === "number") actor.rating = opts.rating;

        if (opts.bornOn !== undefined) actor.bornOn = opts.bornOn;

        if (opts.customFields) {
          for (const key in opts.customFields) {
            const value = opts.customFields[key] !== undefined ? opts.customFields[key] : null;
            logger.log(`Set actor custom.${key} to ${JSON.stringify(value)}`);
            opts.customFields[key] = value;
          }
          actor.customFields = opts.customFields;
        }

        await actorCollection.upsert(actor._id, actor);
        updatedActors.push(actor);
      } else {
        throw new Error(`Actor ${id} not found`);
      }

      await updateActors(updatedActors);
    }

    return updatedActors;
  },

  async removeActors(_: unknown, { ids }: { ids: string[] }): Promise<boolean> {
    for (const id of ids) {
      const actor = await Actor.getById(id);

      if (actor) {
        await Actor.remove(actor);
        await actorIndex.remove([actor._id]);
        await LabelledItem.removeByItem(actor._id);
        await ActorReference.removeByActor(actor._id);
      }
    }
    return true;
  },
};
