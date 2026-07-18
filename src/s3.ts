import type { ApiConfig } from "./config";

export function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
  return cfg.s3Client.presign(key, {
    expiresIn: expireTime
  })
}
