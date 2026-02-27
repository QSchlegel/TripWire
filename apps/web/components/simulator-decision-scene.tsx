"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import type { Decision } from "@tripwire/guard";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import type { SimulatorExecutionStatus } from "@/lib/simulator-smoke-cases";
import { dampValue, decayValue, proximityFalloff } from "./node-animation-core";
import * as THREE from "three";

export type ReducedMotionFallbackMode = "auto" | "always_static";
export type SceneChainStatus = "not_applicable" | "eligible" | "approved_once" | "denied";

export interface SimulatorDecisionSceneProps {
  activeDecision?: Decision;
  activeExecution?: SimulatorExecutionStatus;
  activeChainStatus?: SceneChainStatus;
  activeChainEscalated?: boolean;
  activeIndex: number;
  playbackToken: number;
  eventDurationMs: number;
  isPlaying: boolean;
  onAnimationComplete?: (index: number) => void;
  reducedMotionFallbackMode?: ReducedMotionFallbackMode;
}

type SceneMode = "canvas" | "static";
type StaticReason = "forced" | "reduced-motion" | "no-webgl";
type LaneState = "none" | "allow" | "approval" | "block";

type VisualRoute =
  | "idle"
  | "allow_direct"
  | "allow_after_supervisor"
  | "block_direct"
  | "block_after_supervisor"
  | "approval_hold"
  | "approval_denied"
  | "fallback_block_direct";

interface ScenePaths {
  modelToTripWire: THREE.QuadraticBezierCurve3;
  tripwireToAllow: THREE.QuadraticBezierCurve3;
  tripwireToBlock: THREE.QuadraticBezierCurve3;
  tripwireToSupervisor: THREE.QuadraticBezierCurve3;
  supervisorToAllow: THREE.QuadraticBezierCurve3;
  supervisorToBlock: THREE.QuadraticBezierCurve3;
  allowToDispatcher: THREE.QuadraticBezierCurve3;
}

type PathKey = keyof ScenePaths;

interface RouteDefinition {
  id: VisualRoute;
  segments: PathKey[];
  lane: LaneState;
  pathLabel: string;
  outcomeLabel: string;
}

const DECISION_COLORS: Record<Decision, string> = {
  allow: "#1ddb96",
  require_approval: "#d8893b",
  block: "#f04060"
};

const SUPERVISOR_COLOR = DECISION_COLORS.require_approval;
const DISPATCHER_COLOR = "#89d4ff";
const NEUTRAL_FLOW_COLOR = "#8fb8b4";
const MAX_DELTA = 0.05;

const NODE_POSITIONS: Record<
  "model" | "tripwire" | "supervisor" | "dispatcher" | "allow" | "block",
  THREE.Vector3
> = {
  model: new THREE.Vector3(-3.4, 0, 0),
  tripwire: new THREE.Vector3(-1.2, 0, 0),
  supervisor: new THREE.Vector3(0.8, 1.1, 0),
  dispatcher: new THREE.Vector3(4.25, 1.1, 0),
  allow: new THREE.Vector3(3.45, 0.35, 0),
  block: new THREE.Vector3(3.45, -1.2, 0)
};
type NodeId = keyof typeof NODE_POSITIONS;
type NodeActivityState = Record<NodeId, number>;
const NODE_IDS: NodeId[] = ["model", "tripwire", "supervisor", "dispatcher", "allow", "block"];

function makeNodeActivityState(): NodeActivityState {
  return {
    model: 0,
    tripwire: 0,
    supervisor: 0,
    dispatcher: 0,
    allow: 0,
    block: 0
  };
}

const ROUTES: Record<VisualRoute, RouteDefinition> = {
  idle: {
    id: "idle",
    segments: [],
    lane: "none",
    pathLabel: "Waiting for event",
    outcomeLabel: "No active event"
  },
  allow_direct: {
    id: "allow_direct",
    segments: ["modelToTripWire", "tripwireToAllow", "allowToDispatcher"],
    lane: "allow",
    pathLabel: "Model -> TripWire -> Allow -> Dispatcher",
    outcomeLabel: "Allow executed"
  },
  allow_after_supervisor: {
    id: "allow_after_supervisor",
    segments: ["modelToTripWire", "tripwireToSupervisor", "supervisorToAllow", "allowToDispatcher"],
    lane: "allow",
    pathLabel: "Model -> TripWire -> Supervisor -> Allow -> Dispatcher",
    outcomeLabel: "Supervisor-approved execution"
  },
  block_direct: {
    id: "block_direct",
    segments: ["modelToTripWire", "tripwireToBlock"],
    lane: "block",
    pathLabel: "Model -> TripWire -> Block",
    outcomeLabel: "Blocked before approval flow"
  },
  block_after_supervisor: {
    id: "block_after_supervisor",
    segments: ["modelToTripWire", "tripwireToSupervisor", "supervisorToBlock"],
    lane: "block",
    pathLabel: "Model -> TripWire -> Supervisor -> Block",
    outcomeLabel: "Denied in supervisor flow"
  },
  approval_hold: {
    id: "approval_hold",
    segments: ["modelToTripWire", "tripwireToSupervisor"],
    lane: "approval",
    pathLabel: "Model -> TripWire -> Supervisor",
    outcomeLabel: "Awaiting supervisor approval"
  },
  approval_denied: {
    id: "approval_denied",
    segments: ["modelToTripWire", "tripwireToSupervisor", "supervisorToBlock"],
    lane: "block",
    pathLabel: "Model -> TripWire -> Supervisor -> Block",
    outcomeLabel: "Approval denied"
  },
  fallback_block_direct: {
    id: "fallback_block_direct",
    segments: ["modelToTripWire", "tripwireToBlock"],
    lane: "block",
    pathLabel: "Model -> TripWire -> Block",
    outcomeLabel: "Fallback: conservative block route"
  }
};

function resolveVisualRoute(input: {
  decision?: Decision;
  execution?: SimulatorExecutionStatus;
  chainStatus: SceneChainStatus;
}): RouteDefinition {
  const { decision, execution, chainStatus } = input;

  if (!decision || !execution) {
    return ROUTES.idle;
  }

  if (execution === "approval_required") {
    return ROUTES.approval_hold;
  }

  if (execution === "approval_denied") {
    return ROUTES.approval_denied;
  }

  if (execution === "executed" && decision === "allow" && chainStatus === "not_applicable") {
    return ROUTES.allow_direct;
  }

  if (execution === "executed" && decision === "allow" && chainStatus === "approved_once") {
    return ROUTES.allow_after_supervisor;
  }

  if (execution === "executed" && decision === "require_approval") {
    return ROUTES.allow_after_supervisor;
  }

  if (execution === "blocked" && decision === "block" && chainStatus === "denied") {
    return ROUTES.block_after_supervisor;
  }

  if (execution === "blocked" && decision === "block" && chainStatus === "not_applicable") {
    return ROUTES.block_direct;
  }

  return ROUTES.fallback_block_direct;
}

function curve(start: THREE.Vector3, end: THREE.Vector3, lift: number): THREE.QuadraticBezierCurve3 {
  return new THREE.QuadraticBezierCurve3(
    start.clone(),
    new THREE.Vector3((start.x + end.x) / 2, (start.y + end.y) / 2 + lift, 0),
    end.clone()
  );
}

function makePaths(): ScenePaths {
  return {
    modelToTripWire: curve(NODE_POSITIONS.model, NODE_POSITIONS.tripwire, 0.35),
    tripwireToAllow: curve(NODE_POSITIONS.tripwire, NODE_POSITIONS.allow, 0.52),
    tripwireToBlock: curve(NODE_POSITIONS.tripwire, NODE_POSITIONS.block, -0.55),
    tripwireToSupervisor: curve(NODE_POSITIONS.tripwire, NODE_POSITIONS.supervisor, 0.48),
    supervisorToAllow: curve(NODE_POSITIONS.supervisor, NODE_POSITIONS.allow, -0.22),
    supervisorToBlock: curve(NODE_POSITIONS.supervisor, NODE_POSITIONS.block, -0.72),
    allowToDispatcher: curve(NODE_POSITIONS.allow, NODE_POSITIONS.dispatcher, 0.18)
  };
}

function colorForPath(pathKey: PathKey): string {
  if (pathKey === "tripwireToSupervisor") return DECISION_COLORS.require_approval;
  if (pathKey === "tripwireToBlock" || pathKey === "supervisorToBlock") return DECISION_COLORS.block;
  if (pathKey === "modelToTripWire") return "#82a9a5";
  return DECISION_COLORS.allow;
}

function CurveLine({
  path,
  color,
  opacity
}: {
  path: THREE.QuadraticBezierCurve3;
  color: string;
  opacity: number;
}) {
  const vertices = useMemo(() => {
    const points = path.getPoints(36);
    const data = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i += 1) {
      data[i * 3] = points[i].x;
      data[i * 3 + 1] = points[i].y;
      data[i * 3 + 2] = points[i].z;
    }

    return data;
  }, [path]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[vertices, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </line>
  );
}

function NodeMarker({
  nodeId,
  activityRef,
  position,
  color,
  pulseStrength = 0.05,
  pulseSpeed = 1.8
}: {
  nodeId: NodeId;
  activityRef: MutableRefObject<NodeActivityState>;
  position: THREE.Vector3;
  color: string;
  pulseStrength?: number;
  pulseSpeed?: number;
}) {
  const nodeRef = useRef<THREE.Group>(null);
  const ringPrimaryRef = useRef<THREE.Mesh>(null);
  const ringSecondaryRef = useRef<THREE.Mesh>(null);
  const nodeLightRef = useRef<THREE.PointLight>(null);
  const coreMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringPrimaryMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringSecondaryMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const reactiveLevelRef = useRef(0);
  const tuple = useMemo<[number, number, number]>(
    () => [position.x, position.y, position.z],
    [position]
  );
  const phase = useMemo(() => position.x * 0.73 + position.y * 1.07, [position]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    const t = state.clock.elapsedTime * pulseSpeed + phase;
    const target = activityRef.current[nodeId] ?? 0;
    const reactive = dampValue(reactiveLevelRef.current, target, dt, 10);
    reactiveLevelRef.current = reactive;

    if (nodeRef.current) {
      const scale = 1 + Math.sin(t) * (pulseStrength * 0.5) + reactive * 0.06;
      nodeRef.current.scale.setScalar(scale);
      nodeRef.current.position.y = Math.sin(t * 0.6) * 0.02 + reactive * 0.01;
      nodeRef.current.rotation.z = Math.sin(t * 0.25) * 0.035 + reactive * 0.015;
    }

    if (ringPrimaryRef.current) {
      ringPrimaryRef.current.rotation.z += dt * 0.75;
    }

    if (ringSecondaryRef.current) {
      ringSecondaryRef.current.rotation.z -= dt * 0.55;
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.emissiveIntensity = 0.24 + (Math.sin(t * 1.1) + 1) * 0.1 + reactive * 0.18;
    }

    if (ringPrimaryMaterialRef.current) {
      ringPrimaryMaterialRef.current.emissiveIntensity = 0.11 + (Math.cos(t * 0.95) + 1) * 0.06 + reactive * 0.13;
    }

    if (ringSecondaryMaterialRef.current) {
      ringSecondaryMaterialRef.current.emissiveIntensity = 0.08 + (Math.sin(t * 0.9) + 1) * 0.05 + reactive * 0.1;
    }

    if (haloMaterialRef.current) {
      haloMaterialRef.current.opacity = 0.14 + (Math.sin(t * 1.2) + 1) * 0.04 + reactive * 0.06;
    }

    if (nodeLightRef.current) {
      nodeLightRef.current.intensity = 0.5 + (Math.cos(t * 1.0) + 1) * 0.12 + reactive * 0.24;
    }
  });

  return (
    <group position={tuple}>
      <group ref={nodeRef}>
        <mesh>
          <sphereGeometry args={[0.1, 14, 14]} />
          <meshStandardMaterial
            ref={coreMaterialRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.28}
            metalness={0.22}
            roughness={0.28}
          />
        </mesh>

        <mesh>
          <sphereGeometry args={[0.15, 14, 14]} />
          <meshBasicMaterial
            ref={haloMaterialRef}
            color={color}
            transparent
            toneMapped={false}
            opacity={0.2}
          />
        </mesh>

        <mesh ref={ringPrimaryRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.19, 0.02, 8, 28]} />
          <meshStandardMaterial
            ref={ringPrimaryMaterialRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.16}
            metalness={0.58}
            roughness={0.24}
          />
        </mesh>

        <mesh ref={ringSecondaryRef} rotation={[Math.PI / 2, 0.95, 0]}>
          <torusGeometry args={[0.145, 0.012, 8, 24]} />
          <meshStandardMaterial
            ref={ringSecondaryMaterialRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.12}
            metalness={0.48}
            roughness={0.26}
          />
        </mesh>

        <pointLight ref={nodeLightRef} color={color} intensity={0.62} distance={1.7} />
      </group>
    </group>
  );
}

function TripwireGateMarker({ position }: { position: THREE.Vector3 }) {
  const tuple = useMemo<[number, number, number]>(
    () => [position.x, position.y, position.z],
    [position]
  );
  const groupRef = useRef<THREE.Group>(null);
  const innerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    if (!groupRef.current) return;

    groupRef.current.rotation.y += dt * 0.1;
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.18) * 0.03;
    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.85) * 0.02;

    if (innerMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.5);
      innerMatRef.current.emissiveIntensity = 0.34 + pulse * 0.42;
    }

    if (coreMatRef.current) {
      const phase = (state.clock.elapsedTime % 2.8) / 2.8;
      const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      coreMatRef.current.opacity = 0.82 - eased * 0.22;
    }
  });

  return (
    <group ref={groupRef} position={tuple} scale={[0.13, 0.13, 0.13]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.055, 8, 72]} />
        <meshStandardMaterial
          color="#0b4a2b"
          metalness={0.75}
          roughness={0.2}
          emissive="#1ddb96"
          emissiveIntensity={0.45}
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0.7, 0]}>
        <torusGeometry args={[1.65, 0.045, 8, 56]} />
        <meshStandardMaterial
          color="#6b3c00"
          metalness={0.65}
          roughness={0.25}
          emissive="#f5921f"
          emissiveIntensity={0.55}
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, -0.7, 0]}>
        <torusGeometry args={[0.95, 0.038, 8, 48]} />
        <meshStandardMaterial
          ref={innerMatRef}
          color="#4d0f1d"
          metalness={0.65}
          roughness={0.2}
          emissive="#f04060"
          emissiveIntensity={0.5}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[0.68, 10, 10]} />
        <meshBasicMaterial
          ref={coreMatRef}
          color="#00d6ca"
          toneMapped={false}
          transparent
          opacity={1}
        />
      </mesh>
    </group>
  );
}

function segmentOpacity(route: RouteDefinition, pathKey: PathKey): number {
  if (route.id === "idle") {
    return pathKey === "modelToTripWire" ? 0.6 : 0.18;
  }

  return route.segments.includes(pathKey) ? 0.95 : 0.2;
}

function FlowPacket({
  route,
  playbackKey,
  paths,
  eventDurationMs,
  isPlaying,
  activeIndex,
  onPacketFrame,
  onAnimationComplete
}: {
  route: RouteDefinition;
  playbackKey: string;
  paths: ScenePaths;
  eventDurationMs: number;
  isPlaying: boolean;
  activeIndex: number;
  onPacketFrame?: (position: THREE.Vector3) => void;
  onAnimationComplete?: (index: number) => void;
}) {
  const packetRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const progressRef = useRef(0);
  const completionSentRef = useRef(false);
  const onCompleteRef = useRef(onAnimationComplete);
  const onPacketFrameRef = useRef(onPacketFrame);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    onCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => {
    onPacketFrameRef.current = onPacketFrame;
  }, [onPacketFrame]);

  useEffect(() => {
    progressRef.current = 0;
    completionSentRef.current = false;
    if (packetRef.current) {
      packetRef.current.position.copy(NODE_POSITIONS.model);
      packetRef.current.visible = route.segments.length > 0;
    }
  }, [playbackKey, route.id, route.segments.length]);

  useFrame((state, delta) => {
    const packet = packetRef.current;
    const material = materialRef.current;
    const light = lightRef.current;
    if (!packet || !material || !light) return;

    if (route.segments.length === 0) {
      packet.visible = false;
      light.intensity = 0;
      return;
    }

    packet.visible = true;
    const durationSeconds = Math.max(0.8, eventDurationMs / 1000);

    if (isPlaying && progressRef.current < 1) {
      progressRef.current = Math.min(1, progressRef.current + delta / durationSeconds);
    }

    if (progressRef.current >= 1 && !completionSentRef.current) {
      completionSentRef.current = true;
      if (activeIndex >= 0) {
        onCompleteRef.current?.(activeIndex);
      }
    }

    const progress = progressRef.current;
    const segmentCount = route.segments.length;
    const segmentIndex = Math.min(segmentCount - 1, Math.floor(progress * segmentCount));
    const localStart = segmentIndex / segmentCount;
    const localEnd = (segmentIndex + 1) / segmentCount;
    const localT = (progress - localStart) / Math.max(0.0001, localEnd - localStart);
    const pathKey = route.segments[segmentIndex];
    const path = paths[pathKey];
    path.getPoint(localT, scratch);

    packet.position.copy(scratch);
    onPacketFrameRef.current?.(scratch);
    const pulse = 0.92 + Math.sin(state.clock.elapsedTime * 4.2) * 0.06;
    packet.scale.setScalar(pulse);

    color.set(colorForPath(pathKey) || NEUTRAL_FLOW_COLOR);
    material.color.copy(color);
    material.emissive.copy(color);
    material.emissiveIntensity = 0.6;

    light.position.copy(scratch);
    light.color.copy(color);
    light.intensity = 1.35;
  });

  return (
    <>
      <mesh ref={packetRef}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          ref={materialRef}
          color={NEUTRAL_FLOW_COLOR}
          emissive={NEUTRAL_FLOW_COLOR}
          emissiveIntensity={0.4}
        />
      </mesh>
      <pointLight ref={lightRef} intensity={0} distance={2.8} />
    </>
  );
}

function DecisionFlowScene({
  route,
  playbackKey,
  eventDurationMs,
  isPlaying,
  activeIndex,
  onAnimationComplete
}: {
  route: RouteDefinition;
  playbackKey: string;
  eventDurationMs: number;
  isPlaying: boolean;
  activeIndex: number;
  onAnimationComplete?: (index: number) => void;
}) {
  const paths = useMemo(() => makePaths(), []);
  const nodeActivityRef = useRef<NodeActivityState>(makeNodeActivityState());

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    for (let i = 0; i < NODE_IDS.length; i += 1) {
      const nodeId = NODE_IDS[i];
      nodeActivityRef.current[nodeId] = decayValue(nodeActivityRef.current[nodeId], dt, 4.8);
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[-2, 2.4, 2]} intensity={1.25} color="#9cd6d2" />
      <pointLight position={[3.2, 0, 2]} intensity={0.8} color="#f0f5f5" />

      <CurveLine
        path={paths.modelToTripWire}
        color={colorForPath("modelToTripWire")}
        opacity={segmentOpacity(route, "modelToTripWire")}
      />
      <CurveLine
        path={paths.tripwireToSupervisor}
        color={colorForPath("tripwireToSupervisor")}
        opacity={segmentOpacity(route, "tripwireToSupervisor")}
      />
      <CurveLine
        path={paths.tripwireToAllow}
        color={colorForPath("tripwireToAllow")}
        opacity={segmentOpacity(route, "tripwireToAllow")}
      />
      <CurveLine
        path={paths.supervisorToAllow}
        color={colorForPath("supervisorToAllow")}
        opacity={segmentOpacity(route, "supervisorToAllow")}
      />
      <CurveLine
        path={paths.allowToDispatcher}
        color={colorForPath("allowToDispatcher")}
        opacity={segmentOpacity(route, "allowToDispatcher")}
      />
      <CurveLine
        path={paths.tripwireToBlock}
        color={colorForPath("tripwireToBlock")}
        opacity={segmentOpacity(route, "tripwireToBlock")}
      />
      <CurveLine
        path={paths.supervisorToBlock}
        color={colorForPath("supervisorToBlock")}
        opacity={segmentOpacity(route, "supervisorToBlock")}
      />

      <NodeMarker
        nodeId="model"
        activityRef={nodeActivityRef}
        position={NODE_POSITIONS.model}
        color="#9fd2cf"
        pulseStrength={0.035}
        pulseSpeed={1.4}
      />
      <TripwireGateMarker position={NODE_POSITIONS.tripwire} />
      <NodeMarker
        nodeId="supervisor"
        activityRef={nodeActivityRef}
        position={NODE_POSITIONS.supervisor}
        color={SUPERVISOR_COLOR}
        pulseStrength={0.065}
        pulseSpeed={1.95}
      />
      <NodeMarker
        nodeId="dispatcher"
        activityRef={nodeActivityRef}
        position={NODE_POSITIONS.dispatcher}
        color={DISPATCHER_COLOR}
        pulseStrength={0.04}
        pulseSpeed={1.55}
      />
      <NodeMarker
        nodeId="allow"
        activityRef={nodeActivityRef}
        position={NODE_POSITIONS.allow}
        color={DECISION_COLORS.allow}
        pulseStrength={0.05}
        pulseSpeed={1.9}
      />
      <NodeMarker
        nodeId="block"
        activityRef={nodeActivityRef}
        position={NODE_POSITIONS.block}
        color={DECISION_COLORS.block}
        pulseStrength={0.05}
        pulseSpeed={1.9}
      />

      <FlowPacket
        route={route}
        playbackKey={playbackKey}
        paths={paths}
        eventDurationMs={eventDurationMs}
        isPlaying={isPlaying}
        activeIndex={activeIndex}
        onPacketFrame={(position) => {
          for (let i = 0; i < NODE_IDS.length; i += 1) {
            const nodeId = NODE_IDS[i];
            const influence = proximityFalloff(position.distanceTo(NODE_POSITIONS[nodeId]), 1.1);
            if (influence > nodeActivityRef.current[nodeId]) {
              nodeActivityRef.current[nodeId] = influence;
            }
          }
        }}
        onAnimationComplete={onAnimationComplete}
      />
    </>
  );
}

function staticMessage(reason: StaticReason): string {
  if (reason === "forced") return "Static mode forced by configuration.";
  if (reason === "reduced-motion") return "Static mode enabled because reduced motion is preferred.";
  return "Static mode enabled because WebGL is unavailable.";
}

export function SimulatorDecisionScene({
  activeDecision,
  activeExecution,
  activeChainStatus = "not_applicable",
  activeChainEscalated = false,
  activeIndex,
  playbackToken,
  eventDurationMs,
  isPlaying,
  onAnimationComplete,
  reducedMotionFallbackMode = "auto"
}: SimulatorDecisionSceneProps) {
  const [sceneMode, setSceneMode] = useState<SceneMode>("static");
  const [staticReason, setStaticReason] = useState<StaticReason>("no-webgl");
  const route = useMemo(
    () =>
      resolveVisualRoute({
        decision: activeDecision,
        execution: activeExecution,
        chainStatus: activeChainStatus
      }),
    [activeChainStatus, activeDecision, activeExecution]
  );

  useEffect(() => {
    if (reducedMotionFallbackMode === "always_static") {
      setSceneMode("static");
      setStaticReason("forced");
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSceneMode("static");
      setStaticReason("reduced-motion");
      return;
    }

    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl") ?? probe.getContext("experimental-webgl");
    if (!gl) {
      setSceneMode("static");
      setStaticReason("no-webgl");
      return;
    }

    setSceneMode("canvas");
  }, [reducedMotionFallbackMode]);

  if (sceneMode === "static") {
    return (
      <div className="decision-scene-fallback" role="img" aria-label="Static decision flow diagram">
        <div className="decision-scene-fallback__nodes">
          <span className="decision-scene-fallback__node">Model</span>
          <span className="decision-scene-fallback__arrow">-&gt;</span>
          <span className="decision-scene-fallback__node">TripWire</span>
          <span className="decision-scene-fallback__arrow">-&gt;</span>
          <span className="decision-scene-fallback__node">Supervisor</span>
          <span className="decision-scene-fallback__arrow">-&gt;</span>
          <span className="decision-scene-fallback__node">Dispatcher</span>
        </div>
        <div className="decision-scene-fallback__lanes">
          <span
            className={`decision-scene-fallback__lane decision-scene-fallback__lane--allow${route.lane === "allow" ? " is-active" : ""}`}
          >
            Green: allow
          </span>
          <span
            className={`decision-scene-fallback__lane decision-scene-fallback__lane--approval${route.lane === "approval" ? " is-active" : ""}`}
          >
            Amber: supervisor approval gate
          </span>
          <span
            className={`decision-scene-fallback__lane decision-scene-fallback__lane--block${route.lane === "block" ? " is-active" : ""}`}
          >
            Red: block
          </span>
        </div>
        <p className="decision-scene-fallback__note">
          <strong>Flow:</strong> {route.pathLabel}
        </p>
        <p className="decision-scene-fallback__note">
          <strong>Outcome:</strong> {route.outcomeLabel}
        </p>
        {activeChainEscalated ? (
          <p className="decision-scene-fallback__note">Review trail contained an escalation handoff.</p>
        ) : null}
        <p className="decision-scene-fallback__note">{staticMessage(staticReason)}</p>
      </div>
    );
  }

  // Include event index so autoplay index changes trigger a hard per-event animation reset.
  const playbackKey = `${playbackToken}:${activeIndex}`;

  return (
    <div className="decision-scene-canvas-wrap">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 44 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={1}
        performance={{ min: 0.5 }}
      >
        <DecisionFlowScene
          route={route}
          playbackKey={playbackKey}
          eventDurationMs={eventDurationMs}
          isPlaying={isPlaying}
          activeIndex={activeIndex}
          onAnimationComplete={onAnimationComplete}
        />
      </Canvas>

      <div className="decision-scene-label decision-scene-label--model">Model</div>
      <div className="decision-scene-label decision-scene-label--tripwire">TripWire</div>
      <div className="decision-scene-label decision-scene-label--dispatcher">Dispatcher</div>
      <div className="decision-scene-label decision-scene-label--allow">Green: allow</div>
      <div className="decision-scene-label decision-scene-label--approval">Amber: approval gate</div>
      <div className="decision-scene-label decision-scene-label--block">Red: block</div>
    </div>
  );
}
