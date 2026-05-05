"use client";

import { useEffect, useRef, useState } from 'react';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4';
const FADE_DURATION_MS = 900;
const SWITCH_THRESHOLD_SECONDS = 1.1;

export function PrismaVideoBackground() {
  const primaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeLayerRef = useRef<0 | 1>(0);
  const transitionTimerRef = useRef<number | null>(null);
  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
  }, [activeLayer]);

  useEffect(() => {
    const primaryVideo = primaryVideoRef.current;
    const secondaryVideo = secondaryVideoRef.current;

    if (!primaryVideo || !secondaryVideo) {
      return;
    }

    let cancelled = false;

    const getActiveVideo = () => (activeLayerRef.current === 0 ? primaryVideo : secondaryVideo);
    const getInactiveVideo = () => (activeLayerRef.current === 0 ? secondaryVideo : primaryVideo);

    const playVideo = (video: HTMLVideoElement) => {
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Decorative background only; keep the page usable if autoplay is delayed.
        });
      }
    };

    const resetAndPlay = (video: HTMLVideoElement) => {
      video.currentTime = 0;
      playVideo(video);
    };

    const startPlayback = () => {
      resetAndPlay(primaryVideo);
      resetAndPlay(secondaryVideo);
    };

    const scheduleSwap = () => {
      if (cancelled || transitionTimerRef.current !== null) {
        return;
      }

      const activeVideo = getActiveVideo();
      const inactiveVideo = getInactiveVideo();
      const duration = activeVideo.duration;

      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const remaining = duration - activeVideo.currentTime;

      if (remaining > SWITCH_THRESHOLD_SECONDS) {
        return;
      }

      inactiveVideo.currentTime = 0;
      playVideo(inactiveVideo);
      setActiveLayer((current) => (current === 0 ? 1 : 0));

      transitionTimerRef.current = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        activeVideo.pause();
        activeVideo.currentTime = 0;
        transitionTimerRef.current = null;
      }, FADE_DURATION_MS);
    };

    const handleLoadedData = () => {
      if (primaryVideo.readyState >= 2 && secondaryVideo.readyState >= 2) {
        startPlayback();
      }
    };

    const handleTimeUpdate = () => {
      scheduleSwap();
    };

    primaryVideo.addEventListener('loadeddata', handleLoadedData);
    secondaryVideo.addEventListener('loadeddata', handleLoadedData);
    primaryVideo.addEventListener('timeupdate', handleTimeUpdate);
    secondaryVideo.addEventListener('timeupdate', handleTimeUpdate);

    startPlayback();

    return () => {
      cancelled = true;

      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }

      primaryVideo.removeEventListener('loadeddata', handleLoadedData);
      secondaryVideo.removeEventListener('loadeddata', handleLoadedData);
      primaryVideo.removeEventListener('timeupdate', handleTimeUpdate);
      secondaryVideo.removeEventListener('timeupdate', handleTimeUpdate);
      primaryVideo.pause();
      secondaryVideo.pause();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      <video
        ref={primaryVideoRef}
        autoPlay
        muted
        playsInline
        loop={false}
        preload="auto"
        crossOrigin="anonymous"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[900ms] ease-linear ${activeLayer === 0 ? 'opacity-100' : 'opacity-0'}`}
        src={VIDEO_SRC}
      />

      <video
        ref={secondaryVideoRef}
        autoPlay
        muted
        playsInline
        loop={false}
        preload="auto"
        crossOrigin="anonymous"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[900ms] ease-linear ${activeLayer === 1 ? 'opacity-100' : 'opacity-0'}`}
        src={VIDEO_SRC}
      />

      <div className="noise-overlay pointer-events-none absolute inset-0 opacity-80 mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
    </div>
  );
}
