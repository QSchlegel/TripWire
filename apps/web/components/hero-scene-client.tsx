"use client";

import dynamic from "next/dynamic";

const HeroScene = dynamic(() => import("@/components/hero-scene"), {
  ssr: false
});

export function HeroSceneClient() {
  return <HeroScene />;
}
