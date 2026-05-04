"use client";

import { useEffect, useState } from "react";
import CyberneticGridShader from "./ShaderAnimation";
import Starfield from "./Starfield";
import AntiGravityBackground from "./AntiGravityBackground";

type BackgroundType = "shader" | "starfield" | "antigravity";

export function RandomBackground() {
  const [selectedBg, setSelectedBg] = useState<BackgroundType | null>(null);

  useEffect(() => {
    // Pick a random background on mount
    const variants: BackgroundType[] = ["shader", "starfield", "antigravity"];
    const choice = variants[Math.floor(Math.random() * variants.length)];
    setSelectedBg(choice);
  }, []);

  if (!selectedBg) return null;

  return (
    <>
      {selectedBg === "shader" && <CyberneticGridShader />}
      {selectedBg === "starfield" && (
        <Starfield
          starColor="rgba(255,255,255,0.8)"
          bgColor="rgba(0,0,0,1)"
          mouseAdjust={true}
          speed={0.5}
          quantity={256}
        />
      )}
      {selectedBg === "antigravity" && <AntiGravityBackground />}
    </>
  );
}
