import Axios from "axios";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { chmodSync, existsSync } from "fs";
import { arch, type } from "os";

import { getConfig } from "./config/index";
import { downloadFile } from "./ffmpeg-download";
import { unlinkAsync } from "./fs/async";
import * as logger from "./logger";

export let izzyProcess!: ChildProcessWithoutNullStreams;

export const izzyPath = type() === "Windows_NT" ? "izzy.exe" : "izzy";

export async function deleteIzzy(): Promise<void> {
  await unlinkAsync(izzyPath);
}

export async function resetIzzy(): Promise<void> {
  try {
    await Axios.delete(`http://localhost:${getConfig().IZZY_PORT}/collection`);
  } catch (error) {
    const _err = error as Error;
    logger.error("Error while resetting izzy");
    logger.log(_err.message);
    throw _err;
  }
}

export async function izzyVersion(): Promise<string | null> {
  try {
    const res = await Axios.get<{ version: string }>(`http://localhost:${getConfig().IZZY_PORT}/`);
    return res.data.version;
  } catch {
    return null;
  }
}

interface IGithubAsset {
  // eslint-disable-next-line camelcase
  browser_download_url: string;
  name: string;
}

async function downloadIzzy() {
  logger.log("Fetching Izzy releases...");
  const releaseUrl = `https://api.github.com/repos/boi123212321/izzy/releases/latest`;

  const releaseInfo = (
    await Axios.get<{
      id: string;
    }>(releaseUrl)
  ).data;
  const releaseId = releaseInfo.id;

  const assetsUrl = `https://api.github.com/repos/boi123212321/izzy/releases/${releaseId}/assets`;

  const assets = (await Axios.get(assetsUrl)).data as IGithubAsset[];

  const downloadName = {
    Windows_NT: "izzy.exe",
    Linux: "izzy_linux",
    Darwin: "izzy_mac",
  }[type()] as string;

  if (arch() !== "x64") {
    logger.error("Unsupported architecture " + arch());
    process.exit(1);
  }

  const asset = assets.find((as) => as.name === downloadName);

  if (!asset) {
    logger.error("Izzy release not found: " + downloadName + " for " + type());
    process.exit(1);
  }

  // eslint-disable-next-line camelcase
  await downloadFile(asset.browser_download_url, izzyPath);
  logger.log("CHMOD Izzy...");
  chmodSync(izzyPath, "111");
}

export async function ensureIzzyExists(): Promise<0 | 1> {
  if (existsSync(izzyPath)) {
    logger.log("Izzy binary found");
    return 0;
  } else {
    logger.message("Downloading latest Izzy (database) binary...");
    await downloadIzzy();
    return 1;
  }
}

export function spawnIzzy(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.log("Spawning Izzy");

    const port = getConfig().IZZY_PORT;

    izzyProcess = spawn("./" + izzyPath, ["--port", port.toString()]);
    let responded = false;
    izzyProcess.on("error", (err: Error) => {
      reject(err);
    });
    izzyProcess.stdout.on("data", () => {
      if (!responded) {
        logger.log(`Izzy ready on port ${port}`);
        responded = true;
        resolve();
      }
    });
    izzyProcess.stderr.on("data", (data: Buffer) => {
      logger.izzy(data.toString());
    });
  });
}
