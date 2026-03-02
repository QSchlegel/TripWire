"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { dampValue, proximityFalloff } from "./node-animation-core";
import * as THREE from "three";

const MAX_DELTA = 0.05;
const MODEL_NODE = { x: -4.35, y: -0.24 } as const;
const SUPERVISOR_NODE = { x: -0.68, y: 0.46 } as const;
const ALLOW_GATE_NODE = { x: 1.95, y: 0.16 } as const;
const DISPATCHER_NODE = { x: 4.18, y: -0.3 } as const;
const BLOCK_SINK_NODE = { x: 1.35, y: -2.28 } as const;
const STAGE_NODE_LAYOUT = [MODEL_NODE, SUPERVISOR_NODE, ALLOW_GATE_NODE, DISPATCHER_NODE] as const;
const STAGE_NODE_POSITIONS = STAGE_NODE_LAYOUT.map((node) => new THREE.Vector3(node.x, node.y, 0));
const STATUS_COLORS_DARK = ["#1ddb96", "#f5921f", "#f04060"] as const;
const STATUS_COLORS_LIGHT = ["#127a50", "#b76400", "#b6314d"] as const;
const BRANCH_T = 0.44;
const POSITION_SCRATCH = new THREE.Vector3();

export type DocsSectionId = "top" | "flow" | "quick-path" | "skill" | "api" | "downloads";
export type DocsIntegrationIntensity = "light" | "medium" | "high";

type SceneTone = "dark" | "light";
type NodeActivityRef = MutableRefObject<Float32Array>;

interface SceneTargets {
  stageBoosts: [number, number, number, number];
  laneWeights: [number, number, number];
  guideBoosts: [number, number, number, number, number];
  cameraX: number;
  cameraY: number;
  motionBoost: number;
  panelBoost: number;
}

interface Packet {
  progress: number;
  speed: number;
  lane: 0 | 1 | 2;
  drift: number;
  phase: number;
  colorDirty: boolean;
}

const SECTION_PROFILES: Record<DocsSectionId, Omit<SceneTargets, "cameraY" | "motionBoost"> & { cameraYDelta: number }> = {
  top: {
    stageBoosts: [1.16, 1.06, 1.04, 1.02],
    laneWeights: [1.25, 0.95, 0.78],
    guideBoosts: [1.22, 1.08, 1.05, 0.9, 0.82],
    cameraX: -0.14,
    cameraYDelta: 0.05,
    panelBoost: 1.04
  },
  flow: {
    stageBoosts: [1.42, 1.32, 1.06, 0.98],
    laneWeights: [1.38, 0.94, 0.74],
    guideBoosts: [1.36, 1.14, 1.02, 0.82, 0.76],
    cameraX: -0.3,
    cameraYDelta: 0.08,
    panelBoost: 1.08
  },
  "quick-path": {
    stageBoosts: [1.02, 1.26, 1.4, 1.32],
    laneWeights: [1.46, 1, 0.68],
    guideBoosts: [1.02, 1.42, 1.38, 0.82, 0.74],
    cameraX: 0.12,
    cameraYDelta: 0.1,
    panelBoost: 1.13
  },
  skill: {
    stageBoosts: [0.98, 1.38, 1.34, 1.02],
    laneWeights: [1.12, 1.06, 0.84],
    guideBoosts: [0.96, 1.28, 1.18, 0.95, 0.86],
    cameraX: -0.02,
    cameraYDelta: 0.16,
    panelBoost: 1.17
  },
  api: {
    stageBoosts: [0.92, 1.08, 1.3, 1.42],
    laneWeights: [1.08, 1.34, 0.74],
    guideBoosts: [0.9, 1.18, 1.38, 1.28, 0.8],
    cameraX: 0.26,
    cameraYDelta: 0.1,
    panelBoost: 1.11
  },
  downloads: {
    stageBoosts: [1.05, 1.12, 1.2, 1.2],
    laneWeights: [1.22, 1.1, 0.74],
    guideBoosts: [1.06, 1.2, 1.24, 1.02, 0.86],
    cameraX: 0.08,
    cameraYDelta: 0.06,
    panelBoost: 1.1
  }
};

const INTENSITY_PROFILE: Record<DocsIntegrationIntensity, { sectionGain: number; motionGain: number; cameraGain: number }> = {
  light: { sectionGain: 0.72, motionGain: 0.96, cameraGain: 0.78 },
  medium: { sectionGain: 1, motionGain: 1.08, cameraGain: 1 },
  high: { sectionGain: 1.2, motionGain: 1.18, cameraGain: 1.18 }
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickLane(weights: readonly [number, number, number]): 0 | 1 | 2 {
  const safeWeights: [number, number, number] = [
    Math.max(0.01, weights[0]),
    Math.max(0.01, weights[1]),
    Math.max(0.01, weights[2])
  ];
  const total = safeWeights[0] + safeWeights[1] + safeWeights[2];
  const roll = Math.random() * total;
  if (roll < safeWeights[0]) return 0;
  if (roll < safeWeights[0] + safeWeights[1]) return 1;
  return 2;
}

function buildSceneTargets(
  activeSection: DocsSectionId,
  scrollProgress: number,
  integrationIntensity: DocsIntegrationIntensity
): SceneTargets {
  const profile = SECTION_PROFILES[activeSection];
  const intensity = INTENSITY_PROFILE[integrationIntensity];
  const travelWave = Math.sin(scrollProgress * Math.PI * 2.1);
  const driftWave = Math.sin(scrollProgress * Math.PI * 1.35 + 0.45);

  const stageBoosts = profile.stageBoosts.map((boost, index) =>
    clamp(1 + (boost - 1) * intensity.sectionGain + driftWave * 0.05 * (index % 2 === 0 ? 1 : -1), 0.78, 1.95)
  ) as [number, number, number, number];

  const laneWeights = profile.laneWeights.map((weight, index) =>
    clamp(1 + (weight - 1) * intensity.sectionGain + travelWave * 0.04 * (index === 0 ? 1 : index === 1 ? -1 : 0.5), 0.62, 1.95)
  ) as [number, number, number];

  const guideBoosts = profile.guideBoosts.map((boost, index) =>
    clamp(1 + (boost - 1) * intensity.sectionGain + travelWave * 0.03 * (index < 3 ? 1 : -1), 0.7, 1.95)
  ) as [number, number, number, number, number];

  const cameraY =
    0.28 +
    profile.cameraYDelta * intensity.cameraGain +
    Math.sin(scrollProgress * Math.PI * 1.6) * 0.13 * intensity.cameraGain;

  return {
    stageBoosts,
    laneWeights,
    guideBoosts,
    cameraX: profile.cameraX * intensity.cameraGain + (scrollProgress - 0.5) * 0.46,
    cameraY,
    motionBoost: clamp(1 + (intensity.motionGain - 1) + Math.abs(travelWave) * 0.08, 0.92, 1.42),
    panelBoost: clamp(1 + (profile.panelBoost - 1) * intensity.sectionGain + driftWave * 0.04, 0.88, 1.25)
  };
}

function makePacket(laneWeights: readonly [number, number, number]): Packet {
  return {
    progress: Math.random(),
    speed: 0.24 + Math.random() * 0.36,
    lane: pickLane(laneWeights),
    drift: (Math.random() - 0.5) * 0.35,
    phase: Math.random() * Math.PI * 2,
    colorDirty: true
  };
}

function resetPacket(packet: Packet, laneWeights: readonly [number, number, number]): void {
  packet.progress = 0;
  packet.speed = 0.24 + Math.random() * 0.36;
  packet.lane = pickLane(laneWeights);
  packet.drift = (Math.random() - 0.5) * 0.35;
  packet.phase = Math.random() * Math.PI * 2;
  packet.colorDirty = true;
}

function positionForPacket(packet: Packet, t: number, out: THREE.Vector3): void {
  if (t < BRANCH_T) {
    const lead = t / BRANCH_T;
    const x = MODEL_NODE.x + lead * (SUPERVISOR_NODE.x - MODEL_NODE.x);
    const yBase = MODEL_NODE.y + lead * (SUPERVISOR_NODE.y - MODEL_NODE.y);
    const y = yBase + Math.sin((lead * 1.8 + packet.phase) * Math.PI) * 0.12 + packet.drift * 0.13;
    out.set(x, y, 0);
    return;
  }

  const branchT = (t - BRANCH_T) / (1 - BRANCH_T);

  if (packet.lane === 0) {
    if (branchT < 0.58) {
      const gateT = branchT / 0.58;
      const x = SUPERVISOR_NODE.x + gateT * (ALLOW_GATE_NODE.x - SUPERVISOR_NODE.x);
      const yBase = SUPERVISOR_NODE.y + gateT * (ALLOW_GATE_NODE.y - SUPERVISOR_NODE.y);
      const y = yBase + Math.sin((gateT * 1.85 + packet.phase) * Math.PI) * 0.13 + packet.drift * 0.15;
      out.set(x, y, 0);
      return;
    }

    const dispatchT = (branchT - 0.58) / 0.42;
    const x = ALLOW_GATE_NODE.x + dispatchT * (DISPATCHER_NODE.x - ALLOW_GATE_NODE.x);
    const yBase = ALLOW_GATE_NODE.y + dispatchT * (DISPATCHER_NODE.y - ALLOW_GATE_NODE.y);
    const y = yBase + Math.sin((dispatchT * 1.5 + packet.phase) * Math.PI) * 0.08 + packet.drift * 0.1;
    out.set(x, y, 0);
    return;
  }

  if (packet.lane === 1) {
    const x = SUPERVISOR_NODE.x + branchT * (DISPATCHER_NODE.x - SUPERVISOR_NODE.x);
    const yBase = SUPERVISOR_NODE.y + branchT * (DISPATCHER_NODE.y - SUPERVISOR_NODE.y);
    const y = yBase + Math.sin(branchT * Math.PI) * 1.42 + packet.drift * 0.28;
    out.set(x, y, 0);
    return;
  }

  const branch = Math.min(branchT / 0.82, 1);
  const x = SUPERVISOR_NODE.x + branch * (BLOCK_SINK_NODE.x - SUPERVISOR_NODE.x);
  const yBase = SUPERVISOR_NODE.y + branch * (BLOCK_SINK_NODE.y - SUPERVISOR_NODE.y);
  const y = yBase - Math.sin(branchT * Math.PI * 0.85) * 0.18 + packet.drift * 0.12;
  out.set(x, y, 0);
}

function StageNodes({
  tone,
  nodeActivityRef,
  stageBoostTargets,
  motionBoost
}: {
  tone: SceneTone;
  nodeActivityRef: NodeActivityRef;
  stageBoostTargets: [number, number, number, number];
  motionBoost: number;
}) {
  const groupRefs = useRef<Array<THREE.Group | null>>([]);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const ringMaterialRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const coreMaterialRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const reactiveLevels = useRef<Float32Array>(new Float32Array(STAGE_NODE_POSITIONS.length));
  const stageBoostLevels = useRef<Float32Array>(new Float32Array(STAGE_NODE_POSITIONS.length).fill(1));
  const motionLevel = useRef(1);
  const nodeColors =
    tone === "light"
      ? [
          { ring: "#006d69", core: "#8fdbd6" },
          { ring: "#587886", core: "#d6e6eb" },
          { ring: "#0f7149", core: "#96dcb9" },
          { ring: "#006d69", core: "#8fdbd6" }
        ]
      : [
          { ring: "#00d6ca", core: "#8ffff8" },
          { ring: "#7ca3b2", core: "#d3e8ee" },
          { ring: "#1ddb96", core: "#9ff8ce" },
          { ring: "#00d6ca", core: "#8ffff8" }
        ];
  const ringEmissive = tone === "light" ? 0.23 : 0.4;
  const coreEmissive = tone === "light" ? 0.34 : 0.56;

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    motionLevel.current = dampValue(motionLevel.current, motionBoost, dt, 3.3);
    const activity = nodeActivityRef.current;

    groupRefs.current.forEach((group, index) => {
      if (!group) return;
      stageBoostLevels.current[index] = dampValue(stageBoostLevels.current[index] ?? 1, stageBoostTargets[index] ?? 1, dt, 5.2);
      const stageBoost = stageBoostLevels.current[index] ?? 1;
      const targetActivity = activity[index] ?? 0;
      const combinedActivity = Math.max(targetActivity * stageBoost, (stageBoost - 1) * 0.48);
      const nextActivity = dampValue(reactiveLevels.current[index] ?? 0, combinedActivity, dt, 8.8);
      reactiveLevels.current[index] = nextActivity;

      const t = state.clock.elapsedTime * (0.96 + index * 0.08) + index * 0.62;
      const direction = index % 2 === 0 ? 1 : -1;
      const motion = motionLevel.current;
      const baseNodeY = STAGE_NODE_POSITIONS[index]?.y ?? 0;
      group.rotation.y += dt * (0.16 + index * 0.035) * direction * motion;
      group.rotation.x = Math.sin(t * 0.58) * 0.09 * motion;
      group.rotation.z = Math.sin(t * 0.28) * 0.04;
      // Keep links and nodes aligned by animating around each node's anchor Y, not around 0.
      group.position.y = baseNodeY + Math.sin(t * 0.82) * 0.02 + nextActivity * 0.014;
      const ambientScale = 1 + Math.sin(t * 1.15) * 0.03;
      group.scale.setScalar(ambientScale + nextActivity * 0.08 + (stageBoost - 1) * 0.06);

      const ring = ringRefs.current[index];
      if (ring) {
        ring.rotation.z += dt * (0.38 + index * 0.05) * direction * motion;
      }

      const ambientGlow = (Math.sin(t * 1.2) + 1) * 0.5;
      const ringMaterial = ringMaterialRefs.current[index];
      if (ringMaterial) {
        ringMaterial.emissiveIntensity =
          ringEmissive +
          (tone === "light" ? 0.1 : 0.14) * ambientGlow +
          (tone === "light" ? 0.24 : 0.3) * nextActivity +
          (stageBoost - 1) * (tone === "light" ? 0.12 : 0.16);
      }

      const coreMaterial = coreMaterialRefs.current[index];
      if (coreMaterial) {
        coreMaterial.emissiveIntensity =
          coreEmissive +
          (tone === "light" ? 0.12 : 0.18) * ambientGlow +
          (tone === "light" ? 0.3 : 0.4) * nextActivity +
          (stageBoost - 1) * (tone === "light" ? 0.16 : 0.2);
      }
    });
  });

  return (
    <>
      {STAGE_NODE_POSITIONS.map((position, index) => {
        const colors = nodeColors[index];

        return (
          <group
            key={`${position.x}-${position.y}`}
            ref={(node) => {
              groupRefs.current[index] = node;
            }}
            position={[position.x, position.y, position.z]}
          >
            <mesh
              ref={(node) => {
                ringRefs.current[index] = node;
              }}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <torusGeometry args={[0.72, 0.06, 12, 70]} />
              <meshStandardMaterial
                ref={(material) => {
                  ringMaterialRefs.current[index] = material;
                }}
                color={colors.ring}
                emissive={colors.ring}
                emissiveIntensity={ringEmissive}
              />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.14, 20, 20]} />
              <meshStandardMaterial
                ref={(material) => {
                  coreMaterialRefs.current[index] = material;
                }}
                color={colors.core}
                emissive={colors.ring}
                emissiveIntensity={coreEmissive}
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function FlowGuides({
  tone,
  guideBoostTargets
}: {
  tone: SceneTone;
  guideBoostTargets: [number, number, number, number, number];
}) {
  const intakeColor = tone === "light" ? "#6a8794" : "#7ca3b2";
  const allowColor = tone === "light" ? "#127a50" : "#1ddb96";
  const approvalColor = tone === "light" ? "#b76400" : "#f5921f";
  const blockColor = tone === "light" ? "#b6314d" : "#f04060";
  const baseOpacities = tone === "light" ? [0.24, 0.26, 0.25, 0.26, 0.28] : [0.37, 0.4, 0.38, 0.4, 0.43];
  const baseBlockEmissive = tone === "light" ? 0.24 : 0.46;
  const guideMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const blockMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const guideLevels = useRef<Float32Array>(new Float32Array([1, 1, 1, 1, 1]));
  const intakeCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(MODEL_NODE.x, MODEL_NODE.y, 0),
        new THREE.Vector3(-2.38, 0.02, 0),
        new THREE.Vector3(SUPERVISOR_NODE.x, SUPERVISOR_NODE.y, 0)
      ]),
    []
  );

  const allowCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_NODE.x, SUPERVISOR_NODE.y, 0),
        new THREE.Vector3(0.92, 0.36, 0),
        new THREE.Vector3(ALLOW_GATE_NODE.x, ALLOW_GATE_NODE.y, 0)
      ]),
    []
  );
  const dispatcherCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(ALLOW_GATE_NODE.x, ALLOW_GATE_NODE.y, 0),
        new THREE.Vector3(3.06, -0.02, 0),
        new THREE.Vector3(DISPATCHER_NODE.x, DISPATCHER_NODE.y, 0)
      ]),
    []
  );
  const approvalCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_NODE.x, SUPERVISOR_NODE.y, 0),
        new THREE.Vector3(0.7, 1.52, 0),
        new THREE.Vector3(2.25, 1.38, 0),
        new THREE.Vector3(DISPATCHER_NODE.x, DISPATCHER_NODE.y, 0)
      ]),
    []
  );
  const blockCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_NODE.x, SUPERVISOR_NODE.y, 0),
        new THREE.Vector3(-0.02, -0.18, 0),
        new THREE.Vector3(0.58, -1.15, 0),
        new THREE.Vector3(BLOCK_SINK_NODE.x, BLOCK_SINK_NODE.y, 0)
      ]),
    []
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    const pulse = 0.95 + Math.sin(state.clock.elapsedTime * 1.25) * 0.05;

    for (let i = 0; i < guideLevels.current.length; i += 1) {
      const level = dampValue(guideLevels.current[i] ?? 1, guideBoostTargets[i] ?? 1, dt, 4.8);
      guideLevels.current[i] = level;
      const material = guideMaterialRefs.current[i];
      if (!material) continue;
      material.opacity = baseOpacities[i] * level * pulse;
    }

    if (blockMaterialRef.current) {
      const blockLevel = guideLevels.current[4] ?? 1;
      blockMaterialRef.current.emissiveIntensity = baseBlockEmissive * (0.86 + blockLevel * 0.55);
    }
  });

  return (
    <>
      <mesh>
        <tubeGeometry args={[intakeCurve, 44, 0.03, 8, false]} />
        <meshBasicMaterial
          ref={(material) => {
            guideMaterialRefs.current[0] = material;
          }}
          color={intakeColor}
          transparent
          opacity={baseOpacities[0]}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <tubeGeometry args={[allowCurve, 60, 0.032, 8, false]} />
        <meshBasicMaterial
          ref={(material) => {
            guideMaterialRefs.current[1] = material;
          }}
          color={allowColor}
          transparent
          opacity={baseOpacities[1]}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <tubeGeometry args={[dispatcherCurve, 44, 0.03, 8, false]} />
        <meshBasicMaterial
          ref={(material) => {
            guideMaterialRefs.current[2] = material;
          }}
          color={allowColor}
          transparent
          opacity={baseOpacities[2]}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <tubeGeometry args={[approvalCurve, 60, 0.032, 8, false]} />
        <meshBasicMaterial
          ref={(material) => {
            guideMaterialRefs.current[3] = material;
          }}
          color={approvalColor}
          transparent
          opacity={baseOpacities[3]}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <tubeGeometry args={[blockCurve, 60, 0.032, 8, false]} />
        <meshBasicMaterial
          ref={(material) => {
            guideMaterialRefs.current[4] = material;
          }}
          color={blockColor}
          transparent
          opacity={baseOpacities[4]}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[BLOCK_SINK_NODE.x, BLOCK_SINK_NODE.y - 0.18, 0]}>
        <boxGeometry args={[1.42, 0.22, 0.2]} />
        <meshStandardMaterial
          ref={blockMaterialRef}
          color={blockColor}
          emissive={blockColor}
          emissiveIntensity={baseBlockEmissive}
        />
      </mesh>
    </>
  );
}

function FlowPackets({
  tone,
  nodeActivityRef,
  laneWeightTargets,
  stageBoostTargets,
  motionBoost,
  packetCount
}: {
  tone: SceneTone;
  nodeActivityRef: NodeActivityRef;
  laneWeightTargets: [number, number, number];
  stageBoostTargets: [number, number, number, number];
  motionBoost: number;
  packetCount: number;
}) {
  const statusColors = tone === "light" ? STATUS_COLORS_LIGHT : STATUS_COLORS_DARK;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const laneLevels = useRef<Float32Array>(new Float32Array([1, 1, 1]));
  const stageBoostLevels = useRef<Float32Array>(new Float32Array([1, 1, 1, 1]));
  const motionLevel = useRef(1);
  const packets = useRef<Packet[]>(Array.from({ length: packetCount }, () => makePacket([1, 1, 1])));

  useEffect(() => {
    const laneWeights = laneLevels.current;
    const nextWeights: [number, number, number] = [
      laneWeights[0] || 1,
      laneWeights[1] || 1,
      laneWeights[2] || 1
    ];
    packets.current = Array.from({ length: packetCount }, () => makePacket(nextWeights));
  }, [packetCount]);

  useFrame((state, delta) => {
    const nodeActivity = nodeActivityRef.current;
    nodeActivity.fill(0);

    const mesh = meshRef.current;
    if (!mesh) return;

    const dt = Math.min(delta, MAX_DELTA);
    motionLevel.current = dampValue(motionLevel.current, motionBoost, dt, 3.4);

    for (let laneIndex = 0; laneIndex < laneLevels.current.length; laneIndex += 1) {
      laneLevels.current[laneIndex] = dampValue(laneLevels.current[laneIndex] ?? 1, laneWeightTargets[laneIndex] ?? 1, dt, 4.1);
    }

    for (let stageIndex = 0; stageIndex < stageBoostLevels.current.length; stageIndex += 1) {
      stageBoostLevels.current[stageIndex] = dampValue(
        stageBoostLevels.current[stageIndex] ?? 1,
        stageBoostTargets[stageIndex] ?? 1,
        dt,
        4.8
      );
    }

    const laneWeightsSnapshot: [number, number, number] = [
      laneLevels.current[0] || 1,
      laneLevels.current[1] || 1,
      laneLevels.current[2] || 1
    ];

    let colorNeedsUpdate = false;

    for (let i = 0; i < packets.current.length; i += 1) {
      const packet = packets.current[i];
      const laneSpeedGain = 0.92 + (laneWeightsSnapshot[packet.lane] - 1) * 0.36;
      packet.progress += dt * packet.speed * motionLevel.current * laneSpeedGain;
      if (packet.progress >= 1) resetPacket(packet, laneWeightsSnapshot);

      positionForPacket(packet, packet.progress, POSITION_SCRATCH);

      for (let stageIndex = 0; stageIndex < STAGE_NODE_POSITIONS.length; stageIndex += 1) {
        const influence = proximityFalloff(POSITION_SCRATCH.distanceTo(STAGE_NODE_POSITIONS[stageIndex]), 1.08);
        const boostedInfluence = influence * (stageBoostLevels.current[stageIndex] ?? 1);
        if (boostedInfluence > nodeActivity[stageIndex]) {
          nodeActivity[stageIndex] = boostedInfluence;
        }
      }

      const pulse = 0.82 + Math.sin(state.clock.elapsedTime * 4.2 + packet.phase) * 0.2;
      const fade = packet.lane === 2 && packet.progress > 0.68 ? Math.max(0.11, 1 - (packet.progress - 0.68) / 0.32) : 1;
      const laneScale = 1 + (laneWeightsSnapshot[packet.lane] - 1) * 0.1;

      dummy.position.copy(POSITION_SCRATCH);
      dummy.scale.setScalar(0.096 * pulse * fade * laneScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (packet.colorDirty) {
        color.set(statusColors[packet.lane]);
        mesh.setColorAt(i, color);
        packet.colorDirty = false;
        colorNeedsUpdate = true;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (colorNeedsUpdate && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, packetCount]}>
      <sphereGeometry args={[1, 7, 7]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function CameraRig({ targetX, targetY }: { targetX: number; targetY: number }) {
  const { camera } = useThree();

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    camera.position.x = dampValue(camera.position.x, targetX, dt, 2.1);
    camera.position.y = dampValue(camera.position.y, targetY, dt, 2.3);
    camera.lookAt(0, -0.18, 0);
  });

  return null;
}

function Scene({
  tone,
  activeSection,
  scrollProgress,
  integrationIntensity,
  packetCount
}: {
  tone: SceneTone;
  activeSection: DocsSectionId;
  scrollProgress: number;
  integrationIntensity: DocsIntegrationIntensity;
  packetCount: number;
}) {
  const nodeActivityRef = useRef<Float32Array>(new Float32Array(STAGE_NODE_POSITIONS.length));
  const targets = useMemo(
    () => buildSceneTargets(activeSection, scrollProgress, integrationIntensity),
    [activeSection, scrollProgress, integrationIntensity]
  );

  const ambient = tone === "light" ? 0.45 : 0.42;
  const energy = targets.motionBoost;
  const lightA = (tone === "light" ? 24 : 45) * energy;
  const lightB = (tone === "light" ? 9 : 20) * energy;
  const lightC = (tone === "light" ? 8 : 16) * energy;
  const panelColor = tone === "light" ? "#e8f1f3" : "#06121d";
  const panelOpacity = clamp((tone === "light" ? 0.74 : 0.91) - (targets.panelBoost - 1) * 0.14, 0.62, 0.94);

  return (
    <>
      <ambientLight intensity={ambient} />
      <pointLight position={[0.6, 3.6, 4]} intensity={lightA} color="#9bf7ff" />
      <pointLight position={[-4, -3, 4]} intensity={lightB} color="#f5921f" />
      <pointLight position={[4.5, -2.2, 3]} intensity={lightC} color="#f04060" />

      <mesh position={[0, 0, -0.8]}>
        <planeGeometry args={[13, 6.8]} />
        <meshBasicMaterial color={panelColor} transparent opacity={panelOpacity} />
      </mesh>

      <CameraRig targetX={targets.cameraX} targetY={targets.cameraY} />
      <FlowGuides tone={tone} guideBoostTargets={targets.guideBoosts} />
      <StageNodes tone={tone} nodeActivityRef={nodeActivityRef} stageBoostTargets={targets.stageBoosts} motionBoost={targets.motionBoost} />
      <FlowPackets
        tone={tone}
        nodeActivityRef={nodeActivityRef}
        laneWeightTargets={targets.laneWeights}
        stageBoostTargets={targets.stageBoosts}
        motionBoost={targets.motionBoost}
        packetCount={packetCount}
      />
    </>
  );
}

interface DocsBackgroundSceneProps {
  activeSection: DocsSectionId;
  scrollProgress: number;
  integrationIntensity?: DocsIntegrationIntensity;
}

export function DocsBackgroundScene({
  activeSection,
  scrollProgress,
  integrationIntensity = "medium"
}: DocsBackgroundSceneProps) {
  const [sceneMode, setSceneMode] = useState<"webgl" | "fallback">("fallback");
  const [tone, setTone] = useState<SceneTone>("dark");
  const [packetCount, setPacketCount] = useState(46);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resolveMode = () => {
      if (reducedMotion.matches) {
        setSceneMode("fallback");
        return;
      }

      const probe = document.createElement("canvas");
      const hasWebgl = Boolean(probe.getContext("webgl") ?? probe.getContext("experimental-webgl"));
      setSceneMode(hasWebgl ? "webgl" : "fallback");
    };

    resolveMode();
    reducedMotion.addEventListener("change", resolveMode);

    return () => {
      reducedMotion.removeEventListener("change", resolveMode);
    };
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const tabletQuery = window.matchMedia("(max-width: 1100px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const applyDensity = () => {
      if (reducedMotion.matches) {
        setPacketCount(22);
        return;
      }

      if (mobileQuery.matches) {
        setPacketCount(26);
        return;
      }

      if (tabletQuery.matches) {
        setPacketCount(34);
        return;
      }

      setPacketCount(46);
    };

    applyDensity();
    mobileQuery.addEventListener("change", applyDensity);
    tabletQuery.addEventListener("change", applyDensity);
    reducedMotion.addEventListener("change", applyDensity);

    return () => {
      mobileQuery.removeEventListener("change", applyDensity);
      tabletQuery.removeEventListener("change", applyDensity);
      reducedMotion.removeEventListener("change", applyDensity);
    };
  }, []);

  useEffect(() => {
    const resolveTone = (): SceneTone => {
      const explicit = document.documentElement.getAttribute("data-theme");
      if (explicit === "light" || explicit === "dark") return explicit;
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    };

    const applyTone = () => {
      setTone(resolveTone());
    };

    applyTone();

    const rootObserver = new MutationObserver(applyTone);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const schemeQuery = window.matchMedia("(prefers-color-scheme: light)");
    const onSchemeChange = () => {
      if (!document.documentElement.hasAttribute("data-theme")) applyTone();
    };

    schemeQuery.addEventListener("change", onSchemeChange);

    return () => {
      rootObserver.disconnect();
      schemeQuery.removeEventListener("change", onSchemeChange);
    };
  }, []);

  return (
    <div
      className="docs-scene-background"
      aria-hidden="true"
      data-scene-mode={sceneMode}
      data-active-section={activeSection}
      data-intensity={integrationIntensity}
      data-scene-tone={tone}
    >
      {sceneMode === "webgl" ? (
        <Canvas
          camera={{ position: [0, 0.3, 8.2], fov: 54 }}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          dpr={[1, 1.35]}
          performance={{ min: 0.5, max: 1, debounce: 220 }}
        >
          <Scene
            tone={tone}
            activeSection={activeSection}
            scrollProgress={scrollProgress}
            integrationIntensity={integrationIntensity}
            packetCount={packetCount}
          />
        </Canvas>
      ) : null}
    </div>
  );
}
