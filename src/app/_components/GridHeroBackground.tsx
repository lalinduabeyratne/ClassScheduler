"use client";

import { useEffect, useRef } from "react";

interface LightParticle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  brightness: number;
  gridLine: "horizontal" | "vertical";
  progress: number;
}

export function GridHeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const lights: LightParticle[] = [];
    let lastTime = 0;

    const isDarkMode = () => document.documentElement.classList.contains("dark");

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createLight = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      const gridSize = 40;
      const isHorizontal = Math.random() > 0.5;

      if (isHorizontal) {
        const y = Math.floor(Math.random() * (height / gridSize)) * gridSize;
        return {
          x: 0,
          y,
          targetX: width,
          targetY: y,
          speed: 0.5 + Math.random() * 1.5,
          brightness: 0.8 + Math.random() * 0.2,
          gridLine: "horizontal" as const,
          progress: 0,
        };
      }

      const x = Math.floor(Math.random() * (width / gridSize)) * gridSize;
      return {
        x,
        y: 0,
        targetX: x,
        targetY: height,
        speed: 0.5 + Math.random() * 1.5,
        brightness: 0.8 + Math.random() * 0.2,
        gridLine: "vertical" as const,
        progress: 0,
      };
    };

    const drawGrid = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      const gridSize = 40;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = isDarkMode() ? "#333333" : "#e5e7eb";
      ctx.lineWidth = 1;

      for (let x = -gridSize; x < width + gridSize; x += gridSize) {
        ctx.beginPath();
        for (let y = 0; y <= height; y += 2) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          const wave = Math.sin(distance * 0.02) * 20;
          const perspective = 1 - distance / (width * 0.8);
          const adjustedX = x + wave * Math.max(0, perspective);

          if (y === 0) ctx.moveTo(adjustedX, y);
          else ctx.lineTo(adjustedX, y);
        }
        ctx.stroke();
      }

      for (let y = -gridSize; y < height + gridSize; y += gridSize) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          const wave = Math.sin(distance * 0.02) * 20;
          const perspective = 1 - distance / (height * 0.8);
          const adjustedY = y + wave * Math.max(0, perspective);

          if (x === 0) ctx.moveTo(x, adjustedY);
          else ctx.lineTo(x, adjustedY);
        }
        ctx.stroke();
      }
    };

    const drawLights = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      const centerX = width / 2;
      const centerY = height / 2;

      lights.forEach((light) => {
        const distance = Math.sqrt((light.x - centerX) ** 2 + (light.y - centerY) ** 2);
        const wave = Math.sin(distance * 0.02) * 20;

        let adjustedX = light.x;
        let adjustedY = light.y;

        if (light.gridLine === "vertical") {
          const perspective = 1 - distance / (width * 0.8);
          adjustedX = light.x + wave * Math.max(0, perspective);
        } else {
          const perspective = 1 - distance / (height * 0.8);
          adjustedY = light.y + wave * Math.max(0, perspective);
        }

        const gradient = ctx.createRadialGradient(adjustedX, adjustedY, 0, adjustedX, adjustedY, 15);
        if (isDarkMode()) {
          gradient.addColorStop(0, `rgba(0, 150, 255, ${light.brightness})`);
          gradient.addColorStop(0.5, `rgba(0, 100, 200, ${light.brightness * 0.5})`);
          gradient.addColorStop(1, "rgba(0, 50, 100, 0)");
        } else {
          gradient.addColorStop(0, `rgba(59, 130, 246, ${light.brightness})`);
          gradient.addColorStop(0.5, `rgba(37, 99, 235, ${light.brightness * 0.5})`);
          gradient.addColorStop(1, "rgba(29, 78, 216, 0)");
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(adjustedX, adjustedY, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isDarkMode()
          ? `rgba(255, 255, 255, ${light.brightness})`
          : `rgba(37, 99, 235, ${light.brightness})`;
        ctx.beginPath();
        ctx.arc(adjustedX, adjustedY, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      for (let i = lights.length - 1; i >= 0; i -= 1) {
        const light = lights[i];
        light.progress += light.speed * deltaTime * 0.001;

        if (light.gridLine === "horizontal") {
          light.x = light.progress * light.targetX;
        } else {
          light.y = light.progress * light.targetY;
        }

        if (light.progress >= 1) {
          lights.splice(i, 1);
        }
      }

      if (Math.random() < 0.02) {
        lights.push(createLight());
      }

      if (lights.length > 8) {
        lights.shift();
      }

      drawGrid();
      drawLights();

      animationRef.current = requestAnimationFrame(animate);
    };

    resizeCanvas();
    animationRef.current = requestAnimationFrame(animate);
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current !== undefined) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-white dark:bg-black" aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
