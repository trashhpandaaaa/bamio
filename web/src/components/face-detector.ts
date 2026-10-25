/*
 * MediaPipe's face detector, loaded once per page and shared: the editor's auto-reframe
 * (components/editor/reframe-detect.ts) and a clip's AI face tracking
 * (components/clips/face-track.ts) both ask for it.
 *
 * Its code is served by Bamio (/vendor/mediapipe, from node_modules) and its model from
 * /mediapipe, so nothing about the video leaves the device and no request goes to Google.
 */

export type Detector = {
  detect(image: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement): {
    detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[];
  };
  close(): void;
};

let loading: Promise<Detector> | null = null;

export function faceDetector(): Promise<Detector> {
  loading ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks("/vendor/mediapipe");
    return (await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    })) as unknown as Detector;
  })();
  return loading;
}

/** The faces in one frame, as shares of the picture, biggest first. */
export function facesIn(detector: Detector, image: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) {
  return detector
    .detect(image)
    .detections.map((d) => d.boundingBox)
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((b) => ({ x: (b.originX + b.width / 2) / width, y: (b.originY + b.height / 2) / height, size: b.width * b.height }))
    .sort((a, b) => b.size - a.size);
}

/**
 * The face to follow out of several: the biggest, unless one near where the last one was is
 * nearly as big (a cut to another speaker is followed; someone walking past isn't).
 */
export function faceToFollow(faces: { x: number; y: number; size: number }[], last: { x: number; y: number } | null) {
  let face = faces[0];
  if (last && faces.length > 1) {
    const near = faces.reduce((a, b) => (Math.hypot(a.x - last.x, a.y - last.y) < Math.hypot(b.x - last.x, b.y - last.y) ? a : b));
    if (near.size > face!.size * 0.5) face = near;
  }
  return face;
}
