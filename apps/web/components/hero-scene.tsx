"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// ── helpers ────────────────────────────────────────────────────────

// Shared scratch vec3 — avoids a new allocation on every packet reset
const _v = new THREE.Vector3();

function randomEdgePoint(out: THREE.Vector3, minR = 6, maxR = 11): void {
  const theta = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  out.set(Math.cos(theta) * r, (Math.random() - 0.5) * 8, Math.sin(theta) * r);
}

// Max delta to absorb tab-switch / browser-throttle spikes
const MAX_DELTA = 0.05;

// ── Gate ───────────────────────────────────────────────────────────

function GateMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const innerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    if (!groupRef.current) return;
    groupRef.current.rotation.y += dt * 0.16;
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.28) * 0.06;

    if (innerMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.5);
      innerMatRef.current.emissiveIntensity = 0.3 + pulse * 0.8;
    }

    if (coreMatRef.current) {
      // Match nav-brand pulse timing: 2.8s cycle, brightest at ends, dimmest at midpoint.
      const phase = (state.clock.elapsedTime % 2.8) / 2.8;
      const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      coreMatRef.current.opacity = 1 - eased * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer green ring — reduced tube segments for thin radius */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.055, 8, 72]} />
        <meshStandardMaterial color="#0b4a2b" metalness={0.75} roughness={0.2} emissive="#1ddb96" emissiveIntensity={0.45} />
      </mesh>

      {/* Mid amber ring */}
      <mesh rotation={[Math.PI / 2, 0.7, 0]}>
        <torusGeometry args={[1.65, 0.045, 8, 56]} />
        <meshStandardMaterial color="#6b3c00" metalness={0.65} roughness={0.25} emissive="#f5921f" emissiveIntensity={0.55} />
      </mesh>

      {/* Inner red ring — pulsing */}
      <mesh rotation={[Math.PI / 2, -0.7, 0]}>
        <torusGeometry args={[0.95, 0.038, 8, 48]} />
        <meshStandardMaterial ref={innerMatRef} color="#4d0f1d" metalness={0.65} roughness={0.2} emissive="#f04060" emissiveIntensity={0.5} />
      </mesh>

      {/* Core glow sphere */}
      <mesh>
        <sphereGeometry args={[0.14, 10, 10]} />
        <meshBasicMaterial ref={coreMatRef} color="#00d6ca" toneMapped={false} transparent opacity={1} />
      </mesh>
    </group>
  );
}

// ── Ambient particle cloud ─────────────────────────────────────────

function ParticleField() {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const n = 1000; // halved from 2000
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = 3.5 + Math.random() * 9;
      const y = (Math.random() - 0.5) * 10;
      pts[i * 3]     = Math.cos(theta) * r;
      pts[i * 3 + 1] = y;
      pts[i * 3 + 2] = Math.sin(theta) * r;
    }
    return pts;
  }, []);

  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.038;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#b8e0de" size={0.022} sizeAttenuation transparent opacity={0.4} />
    </points>
  );
}

function BackgroundStars() {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const n = 1800;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 26 + Math.random() * 24;
      pts[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pts[i * 3 + 1] = r * Math.cos(phi);
      pts[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    return pts;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.01;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#d6f4f3" size={0.085} sizeAttenuation transparent opacity={0.65} />
    </points>
  );
}

// ── Flow packets ───────────────────────────────────────────────────

const PACKET_COUNT = 24; // reduced from 30
const PACKET_COLORS = ["#1ddb96", "#f5921f", "#f04060"] as const;

interface Packet {
  start: THREE.Vector3;
  mid: THREE.Vector3;
  progress: number;
  speed: number;
  ci: 0 | 1 | 2;
  colorDirty: boolean; // only upload to GPU when color actually changes
}

function pickColorIdx(): 0 | 1 | 2 {
  const r = Math.random();
  return r < 0.6 ? 0 : r < 0.84 ? 1 : 2;
}

function resetPacket(p: Packet): void {
  randomEdgePoint(_v, 6, 11);
  p.start.copy(_v);
  p.mid.set(
    _v.x * 0.42 + (Math.random() - 0.5) * 1.8,
    _v.y * 0.42 + (Math.random() - 0.5) * 1.8,
    _v.z * 0.42 + (Math.random() - 0.5) * 0.8
  );
  p.progress  = 0;
  p.speed     = 0.11 + Math.random() * 0.19;
  p.ci        = pickColorIdx();
  p.colorDirty = true;
}

function makePacket(): Packet {
  const p: Packet = {
    start: new THREE.Vector3(),
    mid:   new THREE.Vector3(),
    progress:   Math.random(),
    speed:      0.11 + Math.random() * 0.19,
    ci:         pickColorIdx(),
    colorDirty: true,
  };
  randomEdgePoint(_v, 6, 11);
  p.start.copy(_v);
  p.mid.set(
    _v.x * 0.42 + (Math.random() - 0.5) * 1.8,
    _v.y * 0.42 + (Math.random() - 0.5) * 1.8,
    _v.z * 0.42 + (Math.random() - 0.5) * 0.8
  );
  return p;
}

function FlowPackets() {
  const meshRef  = useRef<THREE.InstancedMesh>(null);
  const dummy    = useMemo(() => new THREE.Object3D(), []);
  const col      = useMemo(() => new THREE.Color(), []);
  const packets  = useRef<Packet[]>(Array.from({ length: PACKET_COUNT }, makePacket));

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dt = Math.min(delta, MAX_DELTA);
    let colorDirty = false;

    for (let i = 0; i < PACKET_COUNT; i++) {
      const p = packets.current[i];
      p.progress += dt * p.speed;
      if (p.progress >= 1) resetPacket(p);

      const t  = p.progress;
      const mt = 1 - t;

      dummy.position.set(
        mt * mt * p.start.x + 2 * mt * t * p.mid.x,
        mt * mt * p.start.y + 2 * mt * t * p.mid.y,
        mt * mt * p.start.z + 2 * mt * t * p.mid.z
      );

      const s = t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) : 1;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Only re-upload color to GPU when it actually changed (on reset)
      if (p.colorDirty) {
        col.set(PACKET_COLORS[p.ci]);
        mesh.setColorAt(i, col);
        p.colorDirty = false;
        colorDirty   = true;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PACKET_COUNT]}>
      <sphereGeometry args={[0.07, 6, 6]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

// ── Scene ──────────────────────────────────────────────────────────

function Scene() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[4, 4, 4]}   intensity={2.8} color="#8ffff8" />
      <pointLight position={[-5, -3, -5]} intensity={1.6} color="#f5921f" />

      <BackgroundStars />
      <ParticleField />
      <GateMesh />
      <FlowPackets />
    </>
  );
}

// ── Export ─────────────────────────────────────────────────────────

export default function HeroScene() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const probe = document.createElement("canvas");
    if (probe.getContext("webgl") ?? probe.getContext("experimental-webgl")) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      <Canvas
        camera={{ position: [-3.5, 1.5, 10], fov: 65 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={1}
        performance={{ min: 0.5 }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
