"use client";

import { useEffect, useRef } from 'react';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4';

export function PrismaVideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const startPlayback = () => {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Decorative background only; keep the page usable if autoplay is delayed.
        });
      }
    };

    video.currentTime = 0;
    startPlayback();

    const handleLoadedData = () => {
      startPlayback();
    };

    const handleCanPlay = () => {
      startPlayback();
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('canplay', handleCanPlay);
      video.pause();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        webkit-playsinline="true"
        loop
        disablePictureInPicture
        preload="auto"
        crossOrigin="anonymous"
        className="absolute inset-0 h-full w-full object-cover"
        src={VIDEO_SRC}
      />

      <div className="noise-overlay pointer-events-none absolute inset-0 opacity-80 mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
    </div>
  );
}
