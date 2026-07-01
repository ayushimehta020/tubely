import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  const thumbnailFile = formData.get("thumbnail");

  if (!(thumbnailFile instanceof File)) {
    throw new BadRequestError("No thumbnail file provided");
  }

  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

  if (thumbnailFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  const fileType = thumbnailFile.type;

  const imageData = await thumbnailFile.arrayBuffer();

  const metaData = getVideo(cfg.db, videoId);

  if (!metaData) {
    throw new NotFoundError("Cannot find video");
  }

  if (metaData?.userID !== userID) {
    throw new UserForbiddenError("You are not the owner of this video");
  }

  videoThumbnails.set(videoId, {
    data: imageData,
    mediaType: fileType,
  });

  const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;

  const updatedVideo = {
    ...metaData,
    thumbnailURL,
  };

  updateVideo(cfg.db, updatedVideo);

  return respondWithJSON(200, updatedVideo);
}
