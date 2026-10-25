import { Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { create } from 'zustand';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type PlayerInfo, type Side, clamp, toAbsolute } from '@ghost/engine';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { playback, sampleView, useMatch } from '../store';
import { kitColors, toWorld } from './coords';
import { Ghosts } from './Ghosts';

// Analyst palette: muted, low-contrast grass so the arrows carry the picture.
const LINE = '#e1ebe6';
const GRASS = '#0d1712';
const STRIPES = ['#0f1b15', '#112019'];
const BG = '#0a0c0f';
const LINE_Y = 0.03;

function circlePts(cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 64) {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(toWorld({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, LINE_Y));
  }
  return pts;
}
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ].map(([x, y]) => toWorld({ x: x!, y: y! }, LINE_Y));

function Pitch() {
  const lines = useMemo(() => {
    const L: [number, number, number][][] = [];
    L.push(rect(0, 0, 105, 68));
    L.push([toWorld({ x: 52.5, y: 0 }, LINE_Y), toWorld({ x: 52.5, y: 68 }, LINE_Y)]);
    L.push(circlePts(52.5, 34, 9.15));
    for (const left of [true, false]) {
      const gx = left ? 0 : 105;
      const s = left ? 1 : -1;
      L.push(rect(gx, 34 - 20.16, gx + s * 16.5, 34 + 20.16));
      L.push(rect(gx, 34 - 9.16, gx + s * 5.5, 34 + 9.16));
      const spot = gx + s * 11;
      L.push(circlePts(spot, 34, 0.25, 0, Math.PI * 2, 12));
      const a = Math.acos(5.5 / 9.15);
      L.push(left ? circlePts(spot, 34, 9.15, -a, a, 24) : circlePts(spot, 34, 9.15, Math.PI - a, Math.PI + a, 24));
      // goal frame
      L.push(rect(gx, 34 - 3.66, gx - s * 2, 34 + 3.66));
    }
    for (const [cx, cy, a0] of [[0, 0, 0], [105, 0, Math.PI / 2], [105, 68, Math.PI], [0, 68, -Math.PI / 2]] as const) {
      L.push(circlePts(cx, cy, 1, a0, a0 + Math.PI / 2, 8));
    }
    return L;
  }, []);

  const stripes = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);
  return (
    <group>
      {/* Unlit so the grass is exactly the palette colour; shadows land on a separate catcher. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[125, 88]} />
        <meshBasicMaterial color={GRASS} />
      </mesh>
      {stripes.map((i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[-52.5 + 3.75 + i * 7.5, 0, 0]}>
          <planeGeometry args={[7.5, 68]} />
          <meshBasicMaterial color={STRIPES[i % 2]} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[125, 88]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color={LINE} lineWidth={1.2} transparent opacity={0.45} />
      ))}
      {/* goal posts */}
      {[0, 105].map((gx) =>
        [34 - 3.66, 34 + 3.66].map((gy) => (
          <mesh key={`${gx}-${gy}`} position={toWorld({ x: gx, y: gy }, 1.22)}>
            <cylinderGeometry args={[0.07, 0.07, 2.44, 8]} />
            <meshStandardMaterial color={LINE} />
          </mesh>
        )),
      )}
      {[0, 105].map((gx) => (
        <mesh key={gx} position={toWorld({ x: gx, y: 34 }, 2.44)} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.07, 0.07, 7.32, 8]} />
          <meshStandardMaterial color={LINE} />
        </mesh>
      ))}
    </group>
  );
}

const textures = new Map<string, THREE.CanvasTexture>();
/** Dark text on light kits, white otherwise. */
function badgeText(bg: string) {
  const n = parseInt(bg.replace('#', ''), 16);
  const y = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return y > 0.65 ? '#0a0c0f' : '#ffffff';
}

/** Position badge (ST, RW, LCB…) drawn once per role/kit and cached. 2:1 so three letters fit. */
function badgeTexture(label: string, bg: string): THREE.CanvasTexture {
  const fg = badgeText(bg);
  const key = `${label}|${bg}`;
  let t = textures.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(3, 3, 90, 42, 6);
  g.fill();
  g.stroke();
  g.fillStyle = fg;
  g.font = `700 ${label.length > 2 ? 23 : 27}px 'IBM Plex Sans', system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 48, 25);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

function PlayerMarker({ info, team, colors }: { info: PlayerInfo; team: Side; colors: { main: string; trim: string } }) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const focused = useMatch((s) => s.prefs.focusPlayerId === info.id);
  useFrame(() => {
    const g = ref.current;
    const view = playback.view;
    if (!g || !view) return;
    const p = view.positions.get(info.id);
    if (p) {
      const [x, , z] = toWorld(p);
      g.position.x = x;
      g.position.z = z;
    }
    if (ring.current) ring.current.visible = view.holder === info.id;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.45, 0.9, 4, 12]} />
        <meshStandardMaterial color={info.position === 'GK' ? (team === 'home' ? '#2bd46b' : '#d4c32b') : colors.main} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.95, 24]} />
        <meshBasicMaterial color={colors.trim} transparent opacity={0.85} />
      </mesh>
      {focused && (
        <mesh position={[0, 0.07, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.6, 2.0, 40]} />
          <meshBasicMaterial color="#a48cf0" transparent opacity={0.9} />
        </mesh>
      )}
      <mesh ref={ring} position={[0, 0.08, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[1.15, 1.35, 32]} />
        <meshBasicMaterial color="#e6e8eb" transparent opacity={0.8} />
      </mesh>
      {/* Fixed on-screen size, so badges read the same from the gantry and from pitch level. */}
      <sprite position={[0, 2.6, 0]} scale={[0.052, 0.026, 1]} renderOrder={5}>
        <spriteMaterial map={badgeTexture(info.role, colors.main)} depthTest={false} transparent sizeAttenuation={false} />
      </sprite>
    </group>
  );
}

function Players() {
  const meta = useMatch((s) => s.meta);
  if (!meta) return null;
  const kits = kitColors(meta);
  return (
    <>
      {(['home', 'away'] as Side[]).flatMap((team) =>
        meta[team].players.map((p) => <PlayerMarker key={p.id} info={p} team={team} colors={kits[team]} />),
      )}
    </>
  );
}

function Ball() {
  const ref = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const b = playback.view?.ball;
    if (!b) return;
    const [wx, , wz] = toWorld(b);
    ref.current?.position.set(wx, 0.35 + b.h, wz);
    shadow.current?.position.set(wx, 0.05, wz);
  });
  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[0.38, 20, 20]} />
        <meshStandardMaterial color="white" emissive="#ffffff" emissiveIntensity={0.25} />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.4, 16]} />
        <meshBasicMaterial color="black" transparent opacity={0.35} />
      </mesh>
    </>
  );
}

/** Samples the playback timeline once per frame, before anything else draws. */
function PlaybackDriver() {
  useFrame(() => {
    sampleView(performance.now());
  }, -1);
  return null;
}

const CAM = {
  broadcast: { pos: new THREE.Vector3(0, 52, 62), look: new THREE.Vector3(0, 0, 2) },
  tactical: { pos: new THREE.Vector3(0, 92, 0.01), look: new THREE.Vector3(0, 0, 0) },
};
/** Close camera: how far behind / above the ball it sits (metres). */
const PLAYER_CAM = { back: 15, height: 5.5, ahead: 10 };
/** Sideline camera: beyond the near touchline (world z = 34), high enough to see the far one. */
// Aimed between the two touchlines' sight angles (45° and ~10° down) so both stay in a 45° frame.
const SIDE_CAM = { z: 34 + 14, height: 14, lookZ: 20, maxX: 38 };

/** Viewer-driven camera during a ghost moment: once they drag, the rig lets go until they reset or the moment closes. */
export const useFreeCam = create<{ manual: boolean }>(() => ({ manual: false }));
export const resetCameraView = () => useFreeCam.setState({ manual: false });

function CameraRig() {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const mode = useMatch((s) => s.camera);
  const frozen = useMatch((s) => !!s.ghost);
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const follow = useRef(new THREE.Vector2(52.5, 34));
  const close = useRef(new THREE.Vector2(52.5, 34));
  const side = useRef(0); // sideline camera's x, tracks the ball quickly
  const momentId = useRef<string | undefined>(undefined);
  const heading = useRef(0); // radians in the pitch plane: 0 = home attacking direction
  const headingTarget = useRef(0);
  const attacking = useRef<'home' | 'away' | undefined>(undefined);
  useFrame((_, dt) => {
    const close_ = mode === 'player';
    const target = close_ || mode === 'pitch' ? CAM.broadcast : CAM[mode];
    const pos = target.pos.clone();
    const lk = target.look.clone();
    const { ghost: g, meta } = useMatch.getState();
    const ball = playback.view?.ball;
    // Smoothed ball position so the camera glides rather than snapping with every pass.
    if (ball) {
      follow.current.lerp(new THREE.Vector2(ball.x, ball.y), 1 - Math.exp(-dt * 1.2));
      close.current.lerp(new THREE.Vector2(ball.x, ball.y), 1 - Math.exp(-dt * 2.5));
      side.current += (clamp(ball.x - 52.5, -SIDE_CAM.maxX, SIDE_CAM.maxX) - side.current) * (1 - Math.exp(-dt * 3.5));
    }
    // A new or closed moment hands the camera back to the rig.
    if (g?.moment.eventId !== momentId.current) {
      momentId.current = g?.moment.eventId;
      if (useFreeCam.getState().manual) resetCameraView();
    }
    // Which way is the team on the ball attacking? Swing round smoothly on turnovers.
    const holder = playback.view?.holder;
    if (holder && meta) {
      const side = meta.home.players.some((p) => p.id === holder) ? 'home' : 'away';
      if (attacking.current === undefined) {
        heading.current = headingTarget.current = side === 'home' ? 0 : Math.PI;
      } else if (side !== attacking.current) {
        // Turn 180° round the pitch side of the ball, so mid-swing we look in at the play, not out at the stands.
        const [, , bz] = toWorld({ x: close.current.x, y: close.current.y });
        const mid = bz < 0 ? Math.PI / 2 : -Math.PI / 2;
        const viaPlus = Math.cos(headingTarget.current + Math.PI / 2 - mid) > 0;
        headingTarget.current += viaPlus ? Math.PI : -Math.PI;
      }
      attacking.current = side;
    }
    heading.current += (headingTarget.current - heading.current) * (1 - Math.exp(-dt * 2.5));
    // The viewer has taken the camera.
    if (g && useFreeCam.getState().manual) return;
    // Close cameras follow a what-if exactly like live play; they only need special framing for the freeze.
    if (g && close_ && !playback.whatIf) {
      // Stand just behind the decision-maker and look down the ghost arrow: the option as they saw it.
      const [ax, , az] = toWorld(toAbsolute(g.event.start, g.moment.team));
      const [bx, , bz] = toWorld(toAbsolute(g.moment.ghost.end, g.moment.team));
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const dx = (bx - ax) / l;
      const dz = (bz - az) / l;
      pos.set(ax - dx * 12, 4.5, az - dz * 12);
      lk.set(ax + dx * 10, 0.5, az + dz * 10);
    } else if (mode === 'pitch') {
      // Sideline: always the full width of the pitch, panning along the touchline with the ball
      // (or centred on the two arrows while frozen).
      let sx = side.current;
      if (g && !playback.whatIf) {
        const a = toAbsolute(g.event.start, g.moment.team);
        const b = toAbsolute(g.moment.ghost.end, g.moment.team);
        sx = clamp((a.x + b.x) / 2 - 52.5, -SIDE_CAM.maxX, SIDE_CAM.maxX);
      }
      pos.set(sx, SIDE_CAM.height, SIDE_CAM.z);
      lk.set(sx * 0.9, 0, SIDE_CAM.lookZ);
    } else if (g && !close_) {
      // Swoop to near top-down over the moment (or follow a what-if).
      const a = toAbsolute(g.event.start, g.moment.team);
      const b = toAbsolute(g.moment.ghost.end, g.moment.team);
      let fx = (a.x + b.x) / 2;
      let fy = (a.y + b.y) / 2;
      if (playback.whatIf) {
        fx = (fx + follow.current.x) / 2;
        fy = (fy + follow.current.y) / 2;
      }
      const [wx, , wz] = toWorld({ x: fx, y: fy });
      const cx = clamp(wx, -30, 30);
      const cz = clamp(wz, -12, 12);
      pos.set(cx, 58, cz + 12);
      lk.set(cx, 0, cz);
    } else if (mode === 'broadcast') {
      // Follow the play along the touchline like a TV gantry camera.
      const bx = (follow.current.x - 52.5) * 0.35;
      pos.x = bx;
      lk.x = bx;
    } else if (mode === 'player') {
      // Behind the ball, looking where the team in possession is attacking.
      const [wx, , wz] = toWorld({ x: close.current.x, y: close.current.y });
      const fx = Math.cos(heading.current);
      const fz = Math.sin(heading.current);
      pos.set(wx - fx * PLAYER_CAM.back, PLAYER_CAM.height, wz - fz * PLAYER_CAM.back);
      lk.set(wx + fx * PLAYER_CAM.ahead, 0.5, wz + fz * PLAYER_CAM.ahead);
    }
    const k = 1 - Math.exp(-dt * (frozen ? 2.2 : close_ || mode === 'pitch' ? 3 : 1.6));
    camera.position.lerp(pos, k);
    look.current.lerp(lk, k);
    camera.lookAt(look.current);
    // Keep the orbit pivot on what the rig is looking at, so a drag starts from the current view.
    controls?.target.copy(look.current);
  });
  return null;
}

/** Orbit / pan / zoom, only while a ghost moment is open. */
function FreeLook() {
  const frozen = useMatch((s) => !!s.ghost);
  return (
    <OrbitControls
      makeDefault
      enabled={frozen}
      enableDamping
      dampingFactor={0.12}
      zoomToCursor
      screenSpacePanning={false}
      minDistance={6}
      maxDistance={160}
      maxPolarAngle={Math.PI / 2 - 0.08}
      onStart={() => useFreeCam.setState({ manual: true })}
    />
  );
}

export function PitchScene() {
  return (
    <Canvas shadows camera={{ position: [0, 52, 62], fov: 45, near: 0.5, far: 500 }} dpr={[1, 2]}>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 140, 320]} />
      <hemisphereLight args={['#e6ecf2', '#1a2420', 0.75]} />
      <directionalLight position={[30, 60, 25]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={50} shadow-camera-bottom={-50} />
      <PlaybackDriver />
      <FreeLook />
      <CameraRig />
      <Pitch />
      <Players />
      <Ball />
      <Ghosts />
    </Canvas>
  );
}
