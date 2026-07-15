import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto"
import path from "path";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30

  const { videoId } = req.params as { videoId?: string }
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers)
  const userId = validateJWT(token, cfg.jwtSecret)

  const metadata = getVideo(cfg.db, videoId)

  if (!metadata) {
    throw new NotFoundError("Cannot find video")
  }

  if (metadata.userID !== userId) {
    throw new UserForbiddenError("You are not the owner of this video")
  }

  const formData = await req.formData()
  const videoFile = formData.get("video")

  if (!(videoFile instanceof File)) {
    throw new BadRequestError("No video file provided")
  }

  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file is too large")
  }

  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Invalid video file type")
  }

  const filePath = path.join(
    "/tmp",
    `${randomBytes(16).toString("hex")}.mp4`
  )

  try {
    const arrayBuffer = await videoFile.arrayBuffer()

    await Bun.write(filePath, arrayBuffer)

    const aspectRatio = await getVideoAspectRatio(filePath)

    const key = `${aspectRatio}/${videoId}.mp4`

    await cfg.s3Client
      .file(key)
      .write(Bun.file(filePath), {
        type: videoFile.type
      })

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`

    const updatedVideo = {
      ...metadata,
      videoURL: videoURL
    }

    await updateVideo(cfg.db, updatedVideo)

    return respondWithJSON(200, updatedVideo)
  } finally {
    await Bun.file(filePath).delete()
  }
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath
    ],
    stdout: "pipe",
    stderr: "pipe"
  })

  const stdoutText = await new Response(proc.stdout).text()
  const stderrText = await new Response(proc.stderr).text()

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(stderrText)
  }

  const data = JSON.parse(stdoutText)
  const { width, height } = data.streams[0]

  const ratio = width / height

  const landscape = 16 / 9
  const portrait = 9 / 16
  const tolerance = 0.01

  if (Math.abs(ratio - landscape) < tolerance) {
    return "landscape"
  }

  if (Math.abs(ratio - portrait) < tolerance) {
    return "portrait"
  }

  return "other"
}
