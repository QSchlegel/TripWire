"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Decision } from "@twire/guard";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import type { SimulatorExecutionStatus } from "@/lib/simulator-smoke-cases";
import { dampValue, decayValue, proximityFalloff } from "./node-animation-core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ReducedMotionFallbackMode = "auto" | "always_static";
export type SceneChainStatus = "not_applicable" | "eligible" | "approved_once" | "denied";
export type ScenePresentationMode = "embedded" | "immersive_background";
export type SceneCameraMode = "full" | "limited" | "none";

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
  presentation?: ScenePresentationMode;
  cameraMode?: SceneCameraMode;
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
const NODE_RING_PRIMARY_SPIN = 1.2;
const NODE_RING_SECONDARY_SPIN = -0.92;
const NODE_RING_WOBBLE_X = 0.2;
const NODE_RING_WOBBLE_Y = 0.16;
const NODE_RING_BREATH = 0.045;
const NODE_RING_REACTIVE_BREATH = 0.08;
const NODE_RING_PRIMARY_BASE_X = Math.PI / 2;
const NODE_RING_PRIMARY_BASE_Y = 0;
const NODE_RING_SECONDARY_BASE_X = Math.PI / 2;
const NODE_RING_SECONDARY_BASE_Y = 0.95;
const TRIPWIRE_GROUP_SPIN = 0.1;
const TRIPWIRE_GROUP_WOBBLE_Z = 0.04;
const TRIPWIRE_RING_OUTER_SPIN = 0.46;
const TRIPWIRE_RING_MID_SPIN = -0.62;
const TRIPWIRE_RING_INNER_SPIN = 0.87;
const TRIPWIRE_RING_WOBBLE_X = 0.15;
const TRIPWIRE_RING_WOBBLE_Y = 0.12;

type NodeId = "model" | "tripwire" | "supervisor" | "dispatcher" | "allow" | "block";
type NodeActivityState = Record<NodeId, number>;
const NODE_IDS: NodeId[] = ["model", "tripwire", "supervisor", "dispatcher", "allow", "block"];
type NodeCoordinateTuple = [number, number, number];
type SceneNodeCoordinates = Record<NodeId, NodeCoordinateTuple>;
type SceneLabelProfileKey = "desktop" | "tablet" | "mobile";
type ScenePathLifts = Record<PathKey, number>;

interface SceneCameraProfile {
  fov: number;
  padding: number;
  distanceScale: number;
  minDistance: number;
  maxDistance: number;
  rotateSpeed: number;
  targetOffset: [number, number, number];
}

export interface SceneLayoutProfile {
  id: SceneLabelProfileKey;
  nodes: SceneNodeCoordinates;
  pathLifts: ScenePathLifts;
  camera: SceneCameraProfile;
  labelProfile: SceneLabelProfileKey;
}

export interface ResolvedSceneLayout {
  id: SceneLabelProfileKey;
  nodePositions: Record<NodeId, THREE.Vector3>;
  pathLifts: ScenePathLifts;
  camera: SceneCameraProfile;
  labelProfile: SceneLabelProfileKey;
}

interface SceneLabelPalette {
  textColor: string;
  borderColor: string;
  backgroundColor: string;
}

interface SceneLabelDefinition {
  id: string;
  anchorNode: NodeId;
  palette: SceneLabelPalette;
  variants: Record<SceneLabelProfileKey, SceneLabelVariant>;
}

interface SceneLabelVariant {
  text: string;
  worldOffset: [number, number, number];
  scale: number;
  opacity: number;
}

const LABEL_PALETTE_NEUTRAL: SceneLabelPalette = {
  textColor: "rgba(216, 240, 239, 0.92)",
  borderColor: "rgba(191, 224, 222, 0.28)",
  backgroundColor: "rgba(9, 18, 28, 0.48)"
};

const LABEL_PALETTE_TRIPWIRE: SceneLabelPalette = {
  textColor: "rgba(126, 248, 241, 0.94)",
  borderColor: "rgba(0, 214, 202, 0.34)",
  backgroundColor: "rgba(5, 21, 29, 0.5)"
};

const LABEL_PALETTE_DISPATCHER: SceneLabelPalette = {
  textColor: "rgba(158, 230, 255, 0.94)",
  borderColor: "rgba(137, 212, 255, 0.34)",
  backgroundColor: "rgba(7, 18, 28, 0.5)"
};

const LABEL_PALETTE_ALLOW: SceneLabelPalette = {
  textColor: "rgba(138, 248, 198, 0.94)",
  borderColor: "rgba(29, 219, 150, 0.38)",
  backgroundColor: "rgba(6, 21, 16, 0.52)"
};

const LABEL_PALETTE_APPROVAL: SceneLabelPalette = {
  textColor: "rgba(255, 195, 137, 0.94)",
  borderColor: "rgba(216, 137, 59, 0.36)",
  backgroundColor: "rgba(33, 19, 8, 0.52)"
};

const LABEL_PALETTE_BLOCK: SceneLabelPalette = {
  textColor: "rgba(255, 152, 172, 0.94)",
  borderColor: "rgba(240, 64, 96, 0.4)",
  backgroundColor: "rgba(35, 8, 16, 0.54)"
};

const SCENE_LABELS: SceneLabelDefinition[] = [
  {
    id: "model",
    anchorNode: "model",
    palette: LABEL_PALETTE_NEUTRAL,
    variants: {
      desktop: { text: "Model", worldOffset: [-0.42, -0.48, 0], scale: 0.24, opacity: 0.79 },
      tablet: { text: "Model", worldOffset: [-0.34, -0.45, 0], scale: 0.28, opacity: 0.84 },
      mobile: { text: "Model", worldOffset: [-0.28, -0.44, 0], scale: 0.34, opacity: 0.9 }
    }
  },
  {
    id: "tripwire",
    anchorNode: "tripwire",
    palette: LABEL_PALETTE_TRIPWIRE,
    variants: {
      desktop: { text: "TripWire", worldOffset: [0.62, -0.45, 0], scale: 0.27, opacity: 0.8 },
      tablet: { text: "TripWire", worldOffset: [0.5, -0.47, 0], scale: 0.32, opacity: 0.86 },
      mobile: { text: "TripWire", worldOffset: [0.4, -0.45, 0], scale: 0.38, opacity: 0.92 }
    }
  },
  {
    id: "dispatcher",
    anchorNode: "dispatcher",
    palette: LABEL_PALETTE_DISPATCHER,
    variants: {
      desktop: { text: "Dispatcher", worldOffset: [1.05, 0.04, 0], scale: 0.25, opacity: 0.8 },
      tablet: { text: "Dispatcher", worldOffset: [0.86, 0.12, 0], scale: 0.3, opacity: 0.86 },
      mobile: { text: "Dispatcher", worldOffset: [0.62, 0.2, 0], scale: 0.35, opacity: 0.92 }
    }
  },
  {
    id: "allow",
    anchorNode: "allow",
    palette: LABEL_PALETTE_ALLOW,
    variants: {
      desktop: { text: "Green: allow", worldOffset: [1.18, -0.01, 0], scale: 0.22, opacity: 0.79 },
      tablet: { text: "Green: allow", worldOffset: [0.96, 0.08, 0], scale: 0.27, opacity: 0.85 },
      mobile: { text: "Allow", worldOffset: [0.72, 0.18, 0], scale: 0.34, opacity: 0.9 }
    }
  },
  {
    id: "approval",
    anchorNode: "supervisor",
    palette: LABEL_PALETTE_APPROVAL,
    variants: {
      desktop: { text: "Amber: approval gate", worldOffset: [0.46, -0.5, 0], scale: 0.23, opacity: 0.8 },
      tablet: { text: "Amber: approval gate", worldOffset: [0.4, -0.56, 0], scale: 0.28, opacity: 0.86 },
      mobile: { text: "Approval gate", worldOffset: [0.28, -0.64, 0], scale: 0.35, opacity: 0.91 }
    }
  },
  {
    id: "block",
    anchorNode: "block",
    palette: LABEL_PALETTE_BLOCK,
    variants: {
      desktop: { text: "Red: block", worldOffset: [1.14, -0.03, 0], scale: 0.22, opacity: 0.8 },
      tablet: { text: "Red: block", worldOffset: [0.95, -0.06, 0], scale: 0.27, opacity: 0.85 },
      mobile: { text: "Block", worldOffset: [0.72, -0.06, 0], scale: 0.34, opacity: 0.9 }
    }
  }
];

const LAYOUT_MOBILE_MAX = 640;
const LAYOUT_TABLET_MAX = 1024;
const LAYOUT_DESKTOP_BLEND_END = 1440;
const DEFAULT_VIEWPORT_WIDTH = 1280;

const MOBILE_LAYOUT_PROFILE: SceneLayoutProfile = {
  id: "mobile",
  labelProfile: "mobile",
  nodes: {
    model: [-2.35, -0.02, 0],
    tripwire: [-0.62, 0.02, 0],
    supervisor: [0.54, 1.62, 0],
    dispatcher: [2.86, 1.3, 0],
    allow: [2.12, 0.68, 0],
    block: [2.16, -1.86, 0]
  },
  pathLifts: {
    modelToTripWire: 0.34,
    tripwireToAllow: 0.52,
    tripwireToBlock: -0.66,
    tripwireToSupervisor: 0.62,
    supervisorToAllow: -0.4,
    supervisorToBlock: -0.98,
    allowToDispatcher: 0.18
  },
  camera: {
    fov: 50,
    padding: 1.38,
    distanceScale: 1.08,
    minDistance: 10.4,
    maxDistance: 30,
    rotateSpeed: 0.62,
    targetOffset: [0.05, -0.1, 0]
  }
};

const TABLET_LAYOUT_PROFILE: SceneLayoutProfile = {
  id: "tablet",
  labelProfile: "tablet",
  nodes: {
    model: [-3, -0.02, 0],
    tripwire: [-1.02, 0, 0],
    supervisor: [0.72, 1.48, 0],
    dispatcher: [3.62, 1.28, 0],
    allow: [2.86, 0.58, 0],
    block: [2.92, -1.68, 0]
  },
  pathLifts: {
    modelToTripWire: 0.38,
    tripwireToAllow: 0.58,
    tripwireToBlock: -0.64,
    tripwireToSupervisor: 0.58,
    supervisorToAllow: -0.32,
    supervisorToBlock: -0.86,
    allowToDispatcher: 0.24
  },
  camera: {
    fov: 47,
    padding: 1.32,
    distanceScale: 1.03,
    minDistance: 7.8,
    maxDistance: 26,
    rotateSpeed: 0.68,
    targetOffset: [0.2, -0.06, 0]
  }
};

const DESKTOP_LAYOUT_PROFILE: SceneLayoutProfile = {
  id: "desktop",
  labelProfile: "desktop",
  nodes: {
    model: [-3.6, -0.02, 0],
    tripwire: [-1.25, 0, 0],
    supervisor: [0.95, 1.42, 0],
    dispatcher: [4.35, 1.25, 0],
    allow: [3.5, 0.46, 0],
    block: [3.52, -1.55, 0]
  },
  pathLifts: {
    modelToTripWire: 0.4,
    tripwireToAllow: 0.62,
    tripwireToBlock: -0.68,
    tripwireToSupervisor: 0.6,
    supervisorToAllow: -0.34,
    supervisorToBlock: -0.9,
    allowToDispatcher: 0.26
  },
  camera: {
    fov: 44,
    padding: 1.28,
    distanceScale: 1,
    minDistance: 5.8,
    maxDistance: 23,
    rotateSpeed: 0.7,
    targetOffset: [0.34, -0.08, 0]
  }
};

function lerpNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * THREE.MathUtils.clamp(amount, 0, 1);
}

function lerpTuple(from: NodeCoordinateTuple, to: NodeCoordinateTuple, amount: number): NodeCoordinateTuple {
  return [
    lerpNumber(from[0], to[0], amount),
    lerpNumber(from[1], to[1], amount),
    lerpNumber(from[2], to[2], amount)
  ];
}

function interpolateNodeCoordinates(
  from: SceneNodeCoordinates,
  to: SceneNodeCoordinates,
  amount: number
): SceneNodeCoordinates {
  return {
    model: lerpTuple(from.model, to.model, amount),
    tripwire: lerpTuple(from.tripwire, to.tripwire, amount),
    supervisor: lerpTuple(from.supervisor, to.supervisor, amount),
    dispatcher: lerpTuple(from.dispatcher, to.dispatcher, amount),
    allow: lerpTuple(from.allow, to.allow, amount),
    block: lerpTuple(from.block, to.block, amount)
  };
}

function interpolatePathLifts(from: ScenePathLifts, to: ScenePathLifts, amount: number): ScenePathLifts {
  return {
    modelToTripWire: lerpNumber(from.modelToTripWire, to.modelToTripWire, amount),
    tripwireToAllow: lerpNumber(from.tripwireToAllow, to.tripwireToAllow, amount),
    tripwireToBlock: lerpNumber(from.tripwireToBlock, to.tripwireToBlock, amount),
    tripwireToSupervisor: lerpNumber(from.tripwireToSupervisor, to.tripwireToSupervisor, amount),
    supervisorToAllow: lerpNumber(from.supervisorToAllow, to.supervisorToAllow, amount),
    supervisorToBlock: lerpNumber(from.supervisorToBlock, to.supervisorToBlock, amount),
    allowToDispatcher: lerpNumber(from.allowToDispatcher, to.allowToDispatcher, amount)
  };
}

function interpolateCameraProfile(
  from: SceneCameraProfile,
  to: SceneCameraProfile,
  amount: number
): SceneCameraProfile {
  return {
    fov: lerpNumber(from.fov, to.fov, amount),
    padding: lerpNumber(from.padding, to.padding, amount),
    distanceScale: lerpNumber(from.distanceScale, to.distanceScale, amount),
    minDistance: lerpNumber(from.minDistance, to.minDistance, amount),
    maxDistance: lerpNumber(from.maxDistance, to.maxDistance, amount),
    rotateSpeed: lerpNumber(from.rotateSpeed, to.rotateSpeed, amount),
    targetOffset: [
      lerpNumber(from.targetOffset[0], to.targetOffset[0], amount),
      lerpNumber(from.targetOffset[1], to.targetOffset[1], amount),
      lerpNumber(from.targetOffset[2], to.targetOffset[2], amount)
    ]
  };
}

function dominantLayoutForWidth(viewportWidth: number): SceneLabelProfileKey {
  if (viewportWidth <= 760) return "mobile";
  if (viewportWidth <= 1240) return "tablet";
  return "desktop";
}

function resolveSceneLayout(viewportWidth: number): ResolvedSceneLayout {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : DEFAULT_VIEWPORT_WIDTH;
  let fromProfile = DESKTOP_LAYOUT_PROFILE;
  let toProfile = DESKTOP_LAYOUT_PROFILE;
  let amount = 0;

  if (width <= LAYOUT_MOBILE_MAX) {
    fromProfile = MOBILE_LAYOUT_PROFILE;
    toProfile = MOBILE_LAYOUT_PROFILE;
  } else if (width <= LAYOUT_TABLET_MAX) {
    fromProfile = MOBILE_LAYOUT_PROFILE;
    toProfile = TABLET_LAYOUT_PROFILE;
    amount = (width - LAYOUT_MOBILE_MAX) / (LAYOUT_TABLET_MAX - LAYOUT_MOBILE_MAX);
  } else if (width <= LAYOUT_DESKTOP_BLEND_END) {
    fromProfile = TABLET_LAYOUT_PROFILE;
    toProfile = DESKTOP_LAYOUT_PROFILE;
    amount = (width - LAYOUT_TABLET_MAX) / (LAYOUT_DESKTOP_BLEND_END - LAYOUT_TABLET_MAX);
  }

  const nodes = interpolateNodeCoordinates(fromProfile.nodes, toProfile.nodes, amount);
  const pathLifts = interpolatePathLifts(fromProfile.pathLifts, toProfile.pathLifts, amount);
  const camera = interpolateCameraProfile(fromProfile.camera, toProfile.camera, amount);
  const layoutId = dominantLayoutForWidth(width);
  const nodePositions: Record<NodeId, THREE.Vector3> = {
    model: new THREE.Vector3(...nodes.model),
    tripwire: new THREE.Vector3(...nodes.tripwire),
    supervisor: new THREE.Vector3(...nodes.supervisor),
    dispatcher: new THREE.Vector3(...nodes.dispatcher),
    allow: new THREE.Vector3(...nodes.allow),
    block: new THREE.Vector3(...nodes.block)
  };

  return {
    id: layoutId,
    nodePositions,
    pathLifts,
    camera,
    labelProfile: layoutId
  };
}

function resolveSceneLabels(labelProfile: SceneLabelProfileKey) {
  return SCENE_LABELS.map((label) => {
    const variant = label.variants[labelProfile];
    return {
      id: label.id,
      anchorNode: label.anchorNode,
      palette: label.palette,
      text: variant.text,
      worldOffset: variant.worldOffset,
      scale: variant.scale,
      opacity: variant.opacity
    };
  });
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const clampedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

function createSceneLabelTexture(text: string, palette: SceneLabelPalette): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create label texture context");
  }

  const devicePixelRatio = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  const supersample = 2;
  const pixelRatio = Math.max(1, Math.min(devicePixelRatio * supersample, 6));
  const fontSize = 20;
  const padX = 20;
  const padY = 12;
  const radius = 16;
  const strokeWidth = 1.3;

  context.font = `700 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  context.textBaseline = "middle";
  const textWidth = Math.ceil(context.measureText(text).width);
  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;

  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.lineJoin = "round";
  context.lineCap = "round";
  context.clearRect(0, 0, width, height);
  roundedRectPath(context, strokeWidth / 2, strokeWidth / 2, width - strokeWidth, height - strokeWidth, radius);
  context.fillStyle = palette.backgroundColor;
  context.fill();
  context.strokeStyle = palette.borderColor;
  context.lineWidth = strokeWidth;
  context.stroke();

  context.fillStyle = palette.textColor;
  context.font = `700 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillText(text, width / 2, height / 2 + 0.25);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

function SceneLabelSprite({
  nodePositions,
  anchorNode,
  text,
  worldOffset,
  scale,
  palette,
  opacity
}: {
  nodePositions: Record<NodeId, THREE.Vector3>;
  anchorNode: NodeId;
  text: string;
  worldOffset: [number, number, number];
  scale: number;
  palette: SceneLabelPalette;
  opacity: number;
}) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const materialRef = useRef<THREE.SpriteMaterial>(null);
  const worldPosition = useMemo(
    () =>
      nodePositions[anchorNode]
        .clone()
        .add(new THREE.Vector3(worldOffset[0], worldOffset[1], worldOffset[2])),
    [anchorNode, nodePositions, worldOffset]
  );
  const texture = useMemo(() => createSceneLabelTexture(text, palette), [palette, text]);
  const spriteScale = useMemo<[number, number, number]>(() => {
    const image = texture.image as HTMLCanvasElement;
    const aspect = image.width / image.height;
    return [scale * aspect, scale, 1];
  }, [scale, texture.image]);

  useEffect(() => {
    return () => {
      texture.dispose();
      materialRef.current?.dispose();
    };
  }, [texture]);

  useFrame(({ camera }) => {
    if (!spriteRef.current) return;
    spriteRef.current.position.copy(worldPosition);
    spriteRef.current.quaternion.copy(camera.quaternion);
  });

  return (
    <sprite ref={spriteRef} scale={spriteScale}>
      <spriteMaterial
        ref={materialRef}
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

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

function makePaths(nodePositions: Record<NodeId, THREE.Vector3>, pathLifts: ScenePathLifts): ScenePaths {
  return {
    modelToTripWire: curve(nodePositions.model, nodePositions.tripwire, pathLifts.modelToTripWire),
    tripwireToAllow: curve(nodePositions.tripwire, nodePositions.allow, pathLifts.tripwireToAllow),
    tripwireToBlock: curve(nodePositions.tripwire, nodePositions.block, pathLifts.tripwireToBlock),
    tripwireToSupervisor: curve(nodePositions.tripwire, nodePositions.supervisor, pathLifts.tripwireToSupervisor),
    supervisorToAllow: curve(nodePositions.supervisor, nodePositions.allow, pathLifts.supervisorToAllow),
    supervisorToBlock: curve(nodePositions.supervisor, nodePositions.block, pathLifts.supervisorToBlock),
    allowToDispatcher: curve(nodePositions.allow, nodePositions.dispatcher, pathLifts.allowToDispatcher)
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
      ringPrimaryRef.current.rotation.z += dt * NODE_RING_PRIMARY_SPIN;
      ringPrimaryRef.current.rotation.x =
        NODE_RING_PRIMARY_BASE_X + Math.sin(t * 0.84 + phase * 0.7) * (NODE_RING_WOBBLE_X + reactive * 0.07);
      ringPrimaryRef.current.rotation.y =
        NODE_RING_PRIMARY_BASE_Y + Math.cos(t * 0.62 + phase * 0.35) * (NODE_RING_WOBBLE_Y + reactive * 0.04);
      const ringScale =
        1 +
        Math.sin(t * 1.16 + phase * 0.5) * NODE_RING_BREATH +
        reactive * NODE_RING_REACTIVE_BREATH;
      ringPrimaryRef.current.scale.setScalar(ringScale);
    }

    if (ringSecondaryRef.current) {
      ringSecondaryRef.current.rotation.z += dt * NODE_RING_SECONDARY_SPIN;
      ringSecondaryRef.current.rotation.x =
        NODE_RING_SECONDARY_BASE_X + Math.cos(t * 0.7 + phase * 0.65) * (NODE_RING_WOBBLE_X * 0.8 + reactive * 0.06);
      ringSecondaryRef.current.rotation.y =
        NODE_RING_SECONDARY_BASE_Y + Math.sin(t * 0.92 + phase * 0.3) * (NODE_RING_WOBBLE_Y * 0.75 + reactive * 0.04);
      const ringScale =
        1 +
        Math.cos(t * 1.02 + phase * 0.4) * (NODE_RING_BREATH * 0.82) +
        reactive * (NODE_RING_REACTIVE_BREATH * 0.75);
      ringSecondaryRef.current.scale.setScalar(ringScale);
    }

    if (coreMaterialRef.current) {
      coreMaterialRef.current.emissiveIntensity = 0.24 + (Math.sin(t * 1.1) + 1) * 0.1 + reactive * 0.18;
    }

    if (ringPrimaryMaterialRef.current) {
      ringPrimaryMaterialRef.current.emissiveIntensity =
        0.14 + (Math.cos(t * 1.18) + 1) * 0.09 + reactive * 0.18;
    }

    if (ringSecondaryMaterialRef.current) {
      ringSecondaryMaterialRef.current.emissiveIntensity =
        0.1 + (Math.sin(t * 1.06 + 0.2) + 1) * 0.075 + reactive * 0.14;
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
  const outerRingRef = useRef<THREE.Mesh>(null);
  const middleRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const outerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const middleMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const innerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    groupRef.current.rotation.y += dt * TRIPWIRE_GROUP_SPIN;
    groupRef.current.rotation.z = Math.sin(t * 0.18) * TRIPWIRE_GROUP_WOBBLE_Z;
    groupRef.current.position.y = Math.sin(t * 0.85) * 0.02;

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += dt * TRIPWIRE_RING_OUTER_SPIN;
      outerRingRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.52) * TRIPWIRE_RING_WOBBLE_X;
      outerRingRef.current.rotation.y = Math.sin(t * 0.38 + 0.5) * TRIPWIRE_RING_WOBBLE_Y;
    }

    if (middleRingRef.current) {
      middleRingRef.current.rotation.z += dt * TRIPWIRE_RING_MID_SPIN;
      middleRingRef.current.rotation.x = Math.PI / 2 + Math.cos(t * 0.64 + 0.45) * (TRIPWIRE_RING_WOBBLE_X * 0.88);
      middleRingRef.current.rotation.y = 0.7 + Math.sin(t * 0.48 + 0.9) * (TRIPWIRE_RING_WOBBLE_Y * 0.85);
    }

    if (innerRingRef.current) {
      innerRingRef.current.rotation.z += dt * TRIPWIRE_RING_INNER_SPIN;
      innerRingRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.92 + 0.8) * (TRIPWIRE_RING_WOBBLE_X * 0.8);
      innerRingRef.current.rotation.y = -0.7 + Math.cos(t * 0.58 + 0.2) * (TRIPWIRE_RING_WOBBLE_Y * 0.8);
    }

    if (outerMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
      outerMatRef.current.emissiveIntensity = 0.34 + pulse * 0.28;
    }

    if (middleMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.cos(t * 1.35 + 0.2);
      middleMatRef.current.emissiveIntensity = 0.4 + pulse * 0.3;
    }

    if (innerMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + 0.4);
      innerMatRef.current.emissiveIntensity = 0.34 + pulse * 0.4;
    }

    if (coreMatRef.current) {
      const phase = (t % 2.8) / 2.8;
      const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      coreMatRef.current.opacity = 0.82 - eased * 0.22;
    }
  });

  return (
    <group ref={groupRef} position={tuple} scale={[0.13, 0.13, 0.13]}>
      <mesh ref={outerRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.055, 8, 72]} />
        <meshStandardMaterial
          ref={outerMatRef}
          color="#0b4a2b"
          metalness={0.75}
          roughness={0.2}
          emissive="#1ddb96"
          emissiveIntensity={0.45}
        />
      </mesh>

      <mesh ref={middleRingRef} rotation={[Math.PI / 2, 0.7, 0]}>
        <torusGeometry args={[1.65, 0.045, 8, 56]} />
        <meshStandardMaterial
          ref={middleMatRef}
          color="#6b3c00"
          metalness={0.65}
          roughness={0.25}
          emissive="#f5921f"
          emissiveIntensity={0.55}
        />
      </mesh>

      <mesh ref={innerRingRef} rotation={[Math.PI / 2, -0.7, 0]}>
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
  nodePositions,
  eventDurationMs,
  isPlaying,
  activeIndex,
  onPacketFrame,
  onAnimationComplete
}: {
  route: RouteDefinition;
  playbackKey: string;
  paths: ScenePaths;
  nodePositions: Record<NodeId, THREE.Vector3>;
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
      packetRef.current.position.copy(nodePositions.model);
      packetRef.current.visible = route.segments.length > 0;
    }
  }, [nodePositions, playbackKey, route.id, route.segments.length]);

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
  layout,
  playbackKey,
  eventDurationMs,
  isPlaying,
  activeIndex,
  onAnimationComplete
}: {
  route: RouteDefinition;
  layout: ResolvedSceneLayout;
  playbackKey: string;
  eventDurationMs: number;
  isPlaying: boolean;
  activeIndex: number;
  onAnimationComplete?: (index: number) => void;
}) {
  const paths = useMemo(
    () => makePaths(layout.nodePositions, layout.pathLifts),
    [layout.nodePositions, layout.pathLifts]
  );
  const labels = useMemo(() => resolveSceneLabels(layout.labelProfile), [layout.labelProfile]);
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
        position={layout.nodePositions.model}
        color="#9fd2cf"
        pulseStrength={0.035}
        pulseSpeed={1.4}
      />
      <TripwireGateMarker position={layout.nodePositions.tripwire} />
      <NodeMarker
        nodeId="supervisor"
        activityRef={nodeActivityRef}
        position={layout.nodePositions.supervisor}
        color={SUPERVISOR_COLOR}
        pulseStrength={0.065}
        pulseSpeed={1.95}
      />
      <NodeMarker
        nodeId="dispatcher"
        activityRef={nodeActivityRef}
        position={layout.nodePositions.dispatcher}
        color={DISPATCHER_COLOR}
        pulseStrength={0.04}
        pulseSpeed={1.55}
      />
      <NodeMarker
        nodeId="allow"
        activityRef={nodeActivityRef}
        position={layout.nodePositions.allow}
        color={DECISION_COLORS.allow}
        pulseStrength={0.05}
        pulseSpeed={1.9}
      />
      <NodeMarker
        nodeId="block"
        activityRef={nodeActivityRef}
        position={layout.nodePositions.block}
        color={DECISION_COLORS.block}
        pulseStrength={0.05}
        pulseSpeed={1.9}
      />
      {labels.map((label) => (
        <SceneLabelSprite
          key={label.id}
          nodePositions={layout.nodePositions}
          anchorNode={label.anchorNode}
          text={label.text}
          worldOffset={label.worldOffset}
          scale={label.scale}
          palette={label.palette}
          opacity={label.opacity}
        />
      ))}

      <FlowPacket
        route={route}
        playbackKey={playbackKey}
        paths={paths}
        nodePositions={layout.nodePositions}
        eventDurationMs={eventDurationMs}
        isPlaying={isPlaying}
        activeIndex={activeIndex}
        onPacketFrame={(position) => {
          for (let i = 0; i < NODE_IDS.length; i += 1) {
            const nodeId = NODE_IDS[i];
            const influence = proximityFalloff(position.distanceTo(layout.nodePositions[nodeId]), 1.1);
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

interface SceneBounds {
  width: number;
  height: number;
  center: THREE.Vector3;
}

function getSceneBounds(nodePositions: Record<NodeId, THREE.Vector3>): SceneBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < NODE_IDS.length; i += 1) {
    const node = nodePositions[NODE_IDS[i]];
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    center: new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, 0)
  };
}

function fitDistanceForBounds(bounds: SceneBounds, aspect: number, fovDeg: number, padding: number): number {
  const halfFovRadians = THREE.MathUtils.degToRad(fovDeg * 0.5);
  const paddedHeight = Math.max(bounds.height * padding, 1.8);
  const paddedWidth = Math.max(bounds.width * padding, 2.6);
  const safeAspect = Math.max(aspect, 0.35);
  const heightDistance = paddedHeight / (2 * Math.tan(halfFovRadians));
  const widthDistance = paddedWidth / (2 * Math.tan(halfFovRadians) * safeAspect);
  return Math.max(heightDistance, widthDistance);
}

function SceneCameraControls({
  cameraMode,
  layout,
  viewportWidth
}: {
  cameraMode: SceneCameraMode;
  layout: ResolvedSceneLayout;
  viewportWidth: number;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const scratchTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controlsRef.current = controls;
    const isMobileViewport = viewportWidth <= LAYOUT_MOBILE_MAX;
    const bounds = getSceneBounds(layout.nodePositions);
    const aspect = gl.domElement.clientWidth / Math.max(gl.domElement.clientHeight, 1);
    const fittedDistance =
      fitDistanceForBounds(bounds, aspect, layout.camera.fov, layout.camera.padding) * layout.camera.distanceScale;

    controls.enableDamping = cameraMode !== "none";
    controls.dampingFactor = 0.08;
    controls.enabled = cameraMode !== "none";
    controls.enableRotate = cameraMode !== "none";
    controls.rotateSpeed = layout.camera.rotateSpeed;
    controls.enableZoom = cameraMode === "full";
    controls.enablePan = cameraMode === "full";
    controls.zoomSpeed = 0.95;
    controls.panSpeed = 0.8;

    if (cameraMode === "limited") {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.ROTATE
      };
      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: isMobileViewport ? THREE.TOUCH.ROTATE : THREE.TOUCH.DOLLY_PAN
      };
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = layout.camera.fov;
      camera.updateProjectionMatrix();
    }

    scratchTarget.copy(bounds.center);
    scratchTarget.add(
      new THREE.Vector3(layout.camera.targetOffset[0], layout.camera.targetOffset[1], layout.camera.targetOffset[2])
    );

    controls.minDistance = Math.min(layout.camera.minDistance, fittedDistance);
    controls.maxDistance = Math.max(layout.camera.maxDistance, fittedDistance * 1.9);
    controls.target.copy(scratchTarget);

    camera.position.set(scratchTarget.x, scratchTarget.y, fittedDistance);
    camera.lookAt(scratchTarget);
    controls.update();

    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, cameraMode, gl, layout, scratchTarget, viewportWidth]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
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
  reducedMotionFallbackMode = "auto",
  presentation = "embedded",
  cameraMode = "full"
}: SimulatorDecisionSceneProps) {
  const [sceneMode, setSceneMode] = useState<SceneMode>("static");
  const [staticReason, setStaticReason] = useState<StaticReason>("no-webgl");
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth
  );
  const route = useMemo(
    () =>
      resolveVisualRoute({
        decision: activeDecision,
        execution: activeExecution,
        chainStatus: activeChainStatus
      }),
    [activeChainStatus, activeDecision, activeExecution]
  );
  const layout = useMemo(() => resolveSceneLayout(viewportWidth), [viewportWidth]);

  useEffect(() => {
    let frame = 0;
    const syncWidth = () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth);
      });
    };

    syncWidth();
    window.addEventListener("resize", syncWidth, { passive: true });
    window.addEventListener("orientationchange", syncWidth);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncWidth);
      window.removeEventListener("orientationchange", syncWidth);
    };
  }, []);

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
    const fallbackClassName =
      presentation === "immersive_background"
        ? "decision-scene-fallback decision-scene-fallback--immersive-background"
        : "decision-scene-fallback";

    return (
      <div className={fallbackClassName} role="img" aria-label="Static decision flow diagram">
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
  const canvasWrapClassName =
    presentation === "immersive_background"
      ? "decision-scene-canvas-wrap decision-scene-canvas-wrap--immersive-background"
      : "decision-scene-canvas-wrap";

  return (
    <div className={canvasWrapClassName}>
      <Canvas
        camera={{ position: [0, 0, 12], fov: layout.camera.fov }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
      >
        <SceneCameraControls cameraMode={cameraMode} layout={layout} viewportWidth={viewportWidth} />
        <DecisionFlowScene
          route={route}
          layout={layout}
          playbackKey={playbackKey}
          eventDurationMs={eventDurationMs}
          isPlaying={isPlaying}
          activeIndex={activeIndex}
          onAnimationComplete={onAnimationComplete}
        />
      </Canvas>
    </div>
  );
}
