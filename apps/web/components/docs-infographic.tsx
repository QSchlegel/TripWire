"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const MAX_DELTA = 0.05;
const MODEL_X = -4.1;
const SUPERVISOR_X = -0.1;
const ALLOW_GATE_X = 2.1;
const DISPATCHER_X = 4.15;
const STAGE_X = [-4, 0, ALLOW_GATE_X, DISPATCHER_X] as const;
const PACKET_COUNT = 42;
const STATUS_COLORS_DARK = ["#1ddb96", "#f5921f", "#f04060"] as const;
const STATUS_COLORS_LIGHT = ["#127a50", "#b76400", "#b6314d"] as const;
const BRANCH_T = 0.44;
const POSITION_SCRATCH = new THREE.Vector3();
type SceneTone = "dark" | "light";

interface Packet {
  progress: number;
  speed: number;
  lane: 0 | 1 | 2;
  drift: number;
  phase: number;
  colorDirty: boolean;
}

function pickLane(): 0 | 1 | 2 {
  const roll = Math.random();
  return roll < 0.57 ? 0 : roll < 0.83 ? 1 : 2;
}

function makePacket(): Packet {
  return {
    progress: Math.random(),
    speed: 0.2 + Math.random() * 0.34,
    lane: pickLane(),
    drift: (Math.random() - 0.5) * 0.35,
    phase: Math.random() * Math.PI * 2,
    colorDirty: true
  };
}

function resetPacket(packet: Packet): void {
  packet.progress = 0;
  packet.speed = 0.2 + Math.random() * 0.34;
  packet.lane = pickLane();
  packet.drift = (Math.random() - 0.5) * 0.35;
  packet.phase = Math.random() * Math.PI * 2;
  packet.colorDirty = true;
}

function positionForPacket(packet: Packet, t: number, out: THREE.Vector3): void {
  if (t < BRANCH_T) {
    const lead = t / BRANCH_T;
    const x = MODEL_X + lead * (SUPERVISOR_X - MODEL_X);
    const y = Math.sin((lead * 1.8 + packet.phase) * Math.PI) * 0.08 + packet.drift * 0.12;
    out.set(x, y, 0);
    return;
  }

  const branchT = (t - BRANCH_T) / (1 - BRANCH_T);

  if (packet.lane === 0) {
    if (branchT < 0.58) {
      const gateT = branchT / 0.58;
      const x = SUPERVISOR_X + gateT * (ALLOW_GATE_X - SUPERVISOR_X);
      const y = Math.sin((gateT * 1.9 + packet.phase) * Math.PI) * 0.11 + packet.drift * 0.18;
      out.set(x, y, 0);
      return;
    }

    const dispatchT = (branchT - 0.58) / 0.42;
    const x = ALLOW_GATE_X + dispatchT * (DISPATCHER_X - ALLOW_GATE_X);
    const y = Math.sin((dispatchT * 1.5 + packet.phase) * Math.PI) * 0.07 + packet.drift * 0.12;
    out.set(x, y, 0);
    return;
  }

  if (packet.lane === 1) {
    const x = SUPERVISOR_X + branchT * (DISPATCHER_X - SUPERVISOR_X);
    const y = Math.sin(branchT * Math.PI) * 1.55 + packet.drift * 0.34;
    out.set(x, y, 0);
    return;
  }

  const branch = Math.min(branchT / 0.78, 1);
  const x = SUPERVISOR_X + branch * 1.1;
  const y = -Math.pow(branchT, 1.1) * 1.95 + packet.drift * 0.16;
  out.set(x, y, 0);
}

function StageNodes({ tone }: { tone: SceneTone }) {
  const refs = useRef<Array<THREE.Group | null>>([]);
  const nodeColors =
    tone === "light"
      ? [
          { ring: "#007a75", core: "#7fd8d2" },
          { ring: "#6a8794", core: "#d2e1e7" },
          { ring: "#127a50", core: "#91d8b8" },
          { ring: "#007a75", core: "#7fd8d2" }
        ]
      : [
          { ring: "#00d6ca", core: "#8ffff8" },
          { ring: "#7ca3b2", core: "#d3e8ee" },
          { ring: "#1ddb96", core: "#9ff8ce" },
          { ring: "#00d6ca", core: "#8ffff8" }
        ];
  const ringEmissive = tone === "light" ? 0.16 : 0.28;
  const coreEmissive = tone === "light" ? 0.28 : 0.45;

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    refs.current.forEach((group, index) => {
      if (!group) return;
      const direction = index % 2 === 0 ? 1 : -1;
      group.rotation.y += dt * (0.24 + index * 0.04) * direction;
      group.rotation.x = Math.sin(state.clock.elapsedTime * (0.45 + index * 0.08)) * 0.12;
    });
  });

  return (
    <>
      {STAGE_X.map((x, index) => {
        const colors = nodeColors[index];

        return (
          <group
            key={x}
            ref={(node) => {
              refs.current[index] = node;
            }}
            position={[x, 0, 0]}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.72, 0.06, 12, 70]} />
              <meshStandardMaterial color={colors.ring} emissive={colors.ring} emissiveIntensity={ringEmissive} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.13, 20, 20]} />
              <meshStandardMaterial color={colors.core} emissive={colors.ring} emissiveIntensity={coreEmissive} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function FlowGuides({ tone }: { tone: SceneTone }) {
  const intakeColor = tone === "light" ? "#6a8794" : "#7ca3b2";
  const allowColor = tone === "light" ? "#127a50" : "#1ddb96";
  const approvalColor = tone === "light" ? "#b76400" : "#f5921f";
  const blockColor = tone === "light" ? "#b6314d" : "#f04060";
  const intakeOpacity = tone === "light" ? 0.22 : 0.28;
  const guideOpacity = tone === "light" ? 0.24 : 0.32;
  const approvalOpacity = tone === "light" ? 0.23 : 0.32;
  const blockOpacity = tone === "light" ? 0.24 : 0.35;
  const blockEmissive = tone === "light" ? 0.22 : 0.35;
  const intakeCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(MODEL_X, 0, 0),
        new THREE.Vector3(-2.1, 0.1, 0),
        new THREE.Vector3(SUPERVISOR_X, 0, 0)
      ]),
    []
  );

  const allowCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_X, 0, 0),
        new THREE.Vector3(1.1, 0.12, 0),
        new THREE.Vector3(ALLOW_GATE_X, -0.04, 0)
      ]),
    []
  );
  const dispatcherCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(ALLOW_GATE_X, -0.04, 0),
        new THREE.Vector3(3.05, 0.04, 0),
        new THREE.Vector3(DISPATCHER_X, 0, 0)
      ]),
    []
  );
  const approvalCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_X, 0, 0),
        new THREE.Vector3(0.65, 1.3, 0),
        new THREE.Vector3(2.2, 1.3, 0),
        new THREE.Vector3(DISPATCHER_X, 0, 0)
      ]),
    []
  );
  const blockCurve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(SUPERVISOR_X, 0, 0),
        new THREE.Vector3(0.25, -0.3, 0),
        new THREE.Vector3(0.5, -0.95, 0),
        new THREE.Vector3(0.95, -1.95, 0)
      ]),
    []
  );

  return (
    <>
      <mesh>
        <tubeGeometry args={[intakeCurve, 44, 0.028, 8, false]} />
        <meshBasicMaterial color={intakeColor} transparent opacity={intakeOpacity} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[allowCurve, 60, 0.03, 8, false]} />
        <meshBasicMaterial color={allowColor} transparent opacity={guideOpacity} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[dispatcherCurve, 44, 0.028, 8, false]} />
        <meshBasicMaterial color={allowColor} transparent opacity={guideOpacity} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[approvalCurve, 60, 0.03, 8, false]} />
        <meshBasicMaterial color={approvalColor} transparent opacity={approvalOpacity} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[blockCurve, 60, 0.03, 8, false]} />
        <meshBasicMaterial color={blockColor} transparent opacity={blockOpacity} toneMapped={false} />
      </mesh>
      <mesh position={[0.95, -2.1, 0]}>
        <boxGeometry args={[1.4, 0.2, 0.2]} />
        <meshStandardMaterial color={blockColor} emissive={blockColor} emissiveIntensity={blockEmissive} />
      </mesh>
    </>
  );
}

function FlowPackets({ tone }: { tone: SceneTone }) {
  const statusColors = tone === "light" ? STATUS_COLORS_LIGHT : STATUS_COLORS_DARK;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const packets = useRef<Packet[]>(Array.from({ length: PACKET_COUNT }, makePacket));

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dt = Math.min(delta, MAX_DELTA);
    let colorNeedsUpdate = false;

    for (let i = 0; i < PACKET_COUNT; i += 1) {
      const packet = packets.current[i];
      packet.progress += dt * packet.speed;
      if (packet.progress >= 1) resetPacket(packet);

      positionForPacket(packet, packet.progress, POSITION_SCRATCH);

      const pulse = 0.85 + Math.sin(state.clock.elapsedTime * 4 + packet.phase) * 0.15;
      const fade = packet.lane === 2 && packet.progress > 0.68 ? Math.max(0.12, 1 - (packet.progress - 0.68) / 0.32) : 1;

      dummy.position.copy(POSITION_SCRATCH);
      dummy.scale.setScalar(0.085 * pulse * fade);
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
    <instancedMesh ref={meshRef} args={[undefined, undefined, PACKET_COUNT]}>
      <sphereGeometry args={[1, 7, 7]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

function Scene({ tone }: { tone: SceneTone }) {
  const ambient = tone === "light" ? 0.44 : 0.35;
  const lightA = tone === "light" ? 28 : 45;
  const lightB = tone === "light" ? 11 : 18;
  const lightC = tone === "light" ? 9 : 14;
  const panelColor = tone === "light" ? "#f3f8f9" : "#06131f";
  const panelOpacity = tone === "light" ? 0.84 : 0.94;

  return (
    <>
      <ambientLight intensity={ambient} />
      <pointLight position={[0.6, 3.6, 4]} intensity={lightA} color="#9bf7ff" />
      <pointLight position={[-4, -3, 4]} intensity={lightB} color="#f5921f" />
      <pointLight position={[4.5, -2.2, 3]} intensity={lightC} color="#f04060" />

      <mesh position={[0, 0, -0.8]}>
        <planeGeometry args={[12.5, 6.5]} />
        <meshBasicMaterial color={panelColor} transparent opacity={panelOpacity} />
      </mesh>

      <FlowGuides tone={tone} />
      <StageNodes tone={tone} />
      <FlowPackets tone={tone} />
    </>
  );
}

export function DocsBackgroundScene() {
  const [sceneMode, setSceneMode] = useState<"webgl" | "fallback">("fallback");
  const [tone, setTone] = useState<SceneTone>("dark");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSceneMode("fallback");
      return;
    }

    const probe = document.createElement("canvas");
    const hasWebgl = Boolean(probe.getContext("webgl") ?? probe.getContext("experimental-webgl"));
    setSceneMode(hasWebgl ? "webgl" : "fallback");
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
    <div className="docs-scene-background" aria-hidden="true" data-scene-mode={sceneMode}>
      {sceneMode === "webgl" ? (
        <Canvas camera={{ position: [0, 0.3, 8], fov: 54 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} dpr={[1, 1.5]}>
          <Scene tone={tone} />
        </Canvas>
      ) : null}
    </div>
  );
}
