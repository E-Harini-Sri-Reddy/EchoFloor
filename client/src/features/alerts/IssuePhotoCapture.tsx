import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { MAX_ISSUE_PHOTO_BYTES } from "@/domain/alerts";
import type { IssuePhotoSource } from "@/types/domain";

export interface IssuePhotoValue {
  dataUrl: string;
  name: string;
  bytes: number;
  source: IssuePhotoSource;
}

interface IssuePhotoCaptureProps {
  value: IssuePhotoValue | null;
  error?: string;
  onChange: (value: IssuePhotoValue | null) => void;
  onError: (message: string) => void;
}

export function IssuePhotoCapture({
  value,
  error,
  onChange,
  onError,
}: IssuePhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraFileInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    return () => {
      releaseStream();
    };
  }, []);

  // Attach the stream only after the <video> is mounted.
  useEffect(() => {
    if (!cameraOpen) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let cancelled = false;
    setPreviewReady(false);
    setStatusNote("Starting camera preview…");

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    const markReady = () => {
      if (cancelled) return;
      if (video.videoWidth > 0) {
        setPreviewReady(true);
        setStatusNote("Camera ready. Press Capture photo.");
        onErrorRef.current("");
      }
    };

    const onLoadedMetadata = () => {
      void video
        .play()
        .then(markReady)
        .catch(() => {
          if (!cancelled) {
            setStatusNote(
              "Camera stream connected. If the preview stays black, use Open device camera.",
            );
            window.setTimeout(markReady, 400);
          }
        });
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("playing", markReady);

    if (video.readyState >= 1) {
      onLoadedMetadata();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", markReady);
      video.removeEventListener("playing", markReady);
    };
  }, [cameraOpen]);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function stopCamera() {
    releaseStream();
    setCameraOpen(false);
    setPreviewReady(false);
    setStatusNote("");
    setCameraBusy(false);
  }

  async function requestStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("NO_MEDIA_DEVICES");
    }
    // Prefer rear camera on phones; fall back to any webcam on desktops.
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    }
  }

  async function startCamera() {
    onError("");
    setStatusNote("");
    setCameraBusy(true);
    try {
      // Stop any previous stream before opening a new one.
      releaseStream();
      const stream = await requestStream();
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (error) {
      stopCamera();
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      onError(
        denied
          ? "Camera permission was denied. Allow camera access for this site, or use Upload from device / Open device camera."
          : "Live camera is unavailable in this browser. Use Open device camera (phones) or Upload from device.",
      );
    } finally {
      setCameraBusy(false);
    }
  }

  function openDeviceCamera() {
    onError("");
    setStatusNote("Opening the device camera picker…");
    cameraFileInputRef.current?.click();
  }

  function captureFromStream() {
    const video = videoRef.current;
    if (!video) {
      onError("Camera preview is not available. Try Open device camera instead.");
      return;
    }

    // Retry briefly if metadata just arrived.
    if (!video.videoWidth || !video.videoHeight) {
      onError(
        "Camera preview is not ready yet. Wait a moment for the image, or use Open device camera.",
      );
      return;
    }

    const canvas = document.createElement("canvas");
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      onError("Could not capture from the camera.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    const bytes = estimateDataUrlBytes(dataUrl);
    if (bytes > MAX_ISSUE_PHOTO_BYTES) {
      onError("Captured photo is too large. Try again or upload a smaller image.");
      return;
    }
    // Detect an essentially blank frame (common when stream never painted).
    if (isMostlyBlackFrame(context, canvas.width, canvas.height)) {
      onError(
        "The camera preview looks empty. Allow camera access, close other apps using the camera, then try again — or use Open device camera.",
      );
      return;
    }
    onChange({
      dataUrl,
      name: `camera-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
      bytes,
      source: "camera",
    });
    stopCamera();
    setStatusNote("");
  }

  async function applyFile(file: File, source: IssuePhotoSource) {
    onError("");
    setStatusNote("");
    if (!file.type.startsWith("image/")) {
      onError("Choose an image file (for example JPG or PNG).");
      return;
    }
    if (file.size > MAX_ISSUE_PHOTO_BYTES) {
      onError("Use a photo smaller than about 1.5 MB for this preview.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    onChange({
      dataUrl,
      name: file.name || (source === "camera" ? "camera-capture.jpg" : "issue-photo.jpg"),
      bytes: file.size,
      source,
    });
    stopCamera();
  }

  async function onUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await applyFile(file, "upload");
  }

  async function onCameraFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await applyFile(file, "camera");
  }

  return (
    <section
      className={error ? "issue-photo-section has-error" : "issue-photo-section"}
      aria-labelledby="issue-photo-heading"
    >
      <h3 id="issue-photo-heading">Photo of the issue</h3>
      <p className="muted">
        Required. Use <strong>Take photo</strong> for a live webcam capture,{" "}
        <strong>Open device camera</strong> to launch the phone/OS camera, or{" "}
        <strong>Upload from device</strong> for an existing image. Photos are queued for AI
        false-report screening; administrators review flagged cases.
      </p>

      <div className="row issue-photo-actions">
        <Button type="button" onClick={() => void startCamera()} loading={cameraBusy}>
          Take photo
        </Button>
        <Button type="button" variant="secondary" onClick={openDeviceCamera}>
          Open device camera
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => uploadInputRef.current?.click()}
        >
          Upload from device
        </Button>
        {value || cameraOpen ? (
          <Button
            type="button"
            variant="tertiary"
            onClick={() => {
              stopCamera();
              onChange(null);
              onError("");
            }}
          >
            Clear photo
          </Button>
        ) : null}
      </div>

      <input
        ref={uploadInputRef}
        id="issue-photo-upload"
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => void onUploadChange(event)}
      />
      {/* capture=environment asks mobile browsers for the rear camera app */}
      <input
        ref={cameraFileInputRef}
        id="issue-photo-camera-file"
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => void onCameraFileChange(event)}
      />

      {cameraOpen ? (
        <div className="issue-camera-panel">
          <video
            ref={videoRef}
            className="issue-camera-preview"
            playsInline
            muted
            autoPlay
          />
          <p className="muted">
            {statusNote ||
              (previewReady
                ? "Camera ready. Press Capture photo."
                : "Waiting for camera preview…")}
          </p>
          <div className="row">
            <Button type="button" onClick={captureFromStream} disabled={!previewReady}>
              Capture photo
            </Button>
            <Button type="button" variant="secondary" onClick={openDeviceCamera}>
              Open device camera instead
            </Button>
            <Button type="button" variant="tertiary" onClick={stopCamera}>
              Close camera
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : null}

      {value ? (
        <figure className="issue-photo-preview">
          <img
            src={value.dataUrl}
            alt={
              value.source === "camera"
                ? "Photo taken with the camera"
                : "Uploaded issue photo"
            }
          />
          <figcaption className="muted">
            {value.source === "camera" ? "Taken with camera" : "Uploaded from device"} ·{" "}
            {value.name} · {Math.round(value.bytes / 1024)} KB
          </figcaption>
        </figure>
      ) : null}
    </section>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

function isMostlyBlackFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const sample = context.getImageData(
    0,
    0,
    Math.min(width, 64),
    Math.min(height, 64),
  ).data;
  let lit = 0;
  for (let i = 0; i < sample.length; i += 16) {
    if (sample[i]! + sample[i + 1]! + sample[i + 2]! > 30) lit += 1;
  }
  return lit < 3;
}
