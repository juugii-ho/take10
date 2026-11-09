import * as THREE from 'three';
import { OrbitControls } from './vendor/controls/OrbitControls.js';

export function createViewer(container, data, opts = {}) {
  const { loop = false, onTick } = opts;
  const { space, cast, take } = data;
  const ticks = take.ticks;

  // ---- RENDERER ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x1a1b1e);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';

  // Only add positioning if the container is static (don't override fixed/absolute)
  const _cpos = window.getComputedStyle(container).position;
  if (_cpos === 'static') container.style.position = 'relative';
  container.style.overflow = 'hidden';
  container.style.background = '#1a1b1e';

  // ---- BUBBLE OVERLAY ----
  const bubbleLayer = document.createElement('div');
  bubbleLayer.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;';

  // ---- HUD ----
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:absolute;top:16px;left:16px;z-index:20;',
    'background:rgba(10,11,14,0.72);',
    'border:1px solid rgba(255,255,255,0.12);',
    'border-radius:7px;padding:7px 14px;',
    "font-family:'Courier New',monospace;font-size:13px;color:#fff;",
    'display:flex;align-items:center;gap:10px;',
    'backdrop-filter:blur(6px);',
  ].join('');

  const recDot = document.createElement('span');
  recDot.style.cssText =
    'width:8px;height:8px;border-radius:50%;background:#e74c3c;display:inline-block;flex-shrink:0;';
  const shotLabel = document.createElement('span');
  shotLabel.style.cssText = 'color:#ccc;letter-spacing:0.04em;font-size:12px;';
  const timecode = document.createElement('span');
  timecode.style.cssText =
    'color:#666;font-size:11px;margin-left:2px;letter-spacing:0.08em;';

  hud.appendChild(recDot);
  hud.appendChild(shotLabel);
  hud.appendChild(timecode);

  container.appendChild(canvas);
  container.appendChild(bubbleLayer);
  container.appendChild(hud);

  // ---- SCENE ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b1e);
  // Very light fog only at extreme distances; dense fog hides objects in wide shot
  scene.fog = new THREE.FogExp2(0x1a1b1e, 0.009);

  // ---- CAMERA ----
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    120
  );

  // ---- LIGHTS ----
  // Ambient: guarantees base visibility of all objects regardless of angle
  const ambient = new THREE.AmbientLight(0x40455a, 1.5);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xaabbcc, 0x333640, 0.8);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfff8ee, 2.0);
  // Position over the center of the room, slightly in front
  dir.position.set(space.w * 0.5, 18, space.h * 0.5 - space.h * 0.4);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  const sh = Math.max(space.w, space.h) * 1.0;
  dir.shadow.camera.left = -sh;
  dir.shadow.camera.right = sh;
  dir.shadow.camera.top = sh;
  dir.shadow.camera.bottom = -sh;
  dir.shadow.camera.far = 80;
  dir.shadow.bias = -0.001;
  scene.add(dir);

  // Fill light from the opposite side
  const fill = new THREE.DirectionalLight(0x5577bb, 0.6);
  fill.position.set(space.w * 0.5, 4, space.h * 1.5);
  scene.add(fill);

  // ---- FLOOR ----
  const floorGeo = new THREE.PlaneGeometry(space.w, space.h);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x24262b });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(space.w / 2, 0, space.h / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid — 1 m lines
  const gridSize = Math.max(space.w, space.h) + 4;
  const gridDivs = Math.ceil(gridSize);
  const grid = new THREE.GridHelper(gridSize, gridDivs * 2, 0x2e3140, 0x292c36);
  grid.position.set(space.w / 2, 0.001, space.h / 2);
  scene.add(grid);

  // Ceiling ambient plane (subtle bounce)
  const ceilGeo = new THREE.PlaneGeometry(space.w + 2, space.h + 2);
  const ceilMat = new THREE.MeshBasicMaterial({ color: 0x1e2028, side: THREE.BackSide });
  const ceil = new THREE.Mesh(ceilGeo, ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(space.w / 2, 3.2, space.h / 2);
  scene.add(ceil);

  // ---- SPACE OBJECTS ----
  // MeshPhongMaterial: WebGL 1.0 safe, supports emissive for guaranteed visibility
  const matTable   = new THREE.MeshPhongMaterial({ color: 0x5a5f6a, emissive: 0x1a1d22, shininess: 20 });
  const matCounter = new THREE.MeshPhongMaterial({ color: 0x626875, emissive: 0x1c1f26, shininess: 25 });
  const matDoor    = new THREE.MeshPhongMaterial({ color: 0x7a5535, emissive: 0x1a1008, shininess: 10 });
  const matEdge = new THREE.LineBasicMaterial({
    color: 0xa0a8be,
    transparent: true,
    opacity: 0.75,
  });

  for (const obj of space.objects) {
    let h, mat;
    if (obj.type === 'table') { h = 0.76; mat = matTable; }
    else if (obj.type === 'counter') { h = 1.05; mat = matCounter; }
    else { h = 2.1; mat = matDoor; }

    const geo = new THREE.BoxGeometry(obj.w, h, obj.h);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obj.x + obj.w / 2, h / 2, obj.y + obj.h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edges = new THREE.EdgesGeometry(geo);
    mesh.add(new THREE.LineSegments(edges, matEdge.clone()));
    scene.add(mesh);
  }

  // ---- ACTORS ----
  const castMap = {};
  for (const c of cast) castMap[c.name] = c;

  // actor mesh registry: name -> { group, head, ring }
  const actorMeshes = {};

  for (const c of cast) {
    const color = new THREE.Color(c.color);
    const group = new THREE.Group();

    // Glow ring on floor
    const ringGeo = new THREE.RingGeometry(0.33, 0.52, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;  // above floor to avoid z-fighting
    group.add(ring);

    // Body (capsule approximation: cylinder + two sphere caps)
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.05, 14);
    const bodyMat = new THREE.MeshPhongMaterial({
      color: 0xd8dae2,
      emissive: 0x282a30,
      shininess: 15,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.75;
    body.castShadow = true;
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 18, 14);
    const headMat = new THREE.MeshPhongMaterial({
      color: 0xecedf2,
      emissive: 0x2a2c33,
      shininess: 20,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.52;
    head.castShadow = true;
    group.add(head);

    // Accent dot on front of head (direction indicator)
    const dotGeo = new THREE.SphereGeometry(0.055, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(0, 1.52, -0.19);
    group.add(dot);

    scene.add(group);
    actorMeshes[c.name] = { group, head, ring };
  }

  // ---- BUBBLE HTML DIVS ----
  const bubbleDivs = {};
  for (const c of cast) {
    const sayDiv = document.createElement('div');
    sayDiv.style.cssText = [
      'position:absolute;',
      'background:#ffffff;color:#111;',
      'border-radius:10px;padding:5px 11px;',
      "font-family:system-ui,sans-serif;font-size:13px;",
      'max-width:180px;text-align:center;',
      'pointer-events:none;display:none;',
      'box-shadow:0 3px 10px rgba(0,0,0,0.5);',
      'white-space:nowrap;',
      'transform:translate(-50%,-100%);',
    ].join('');

    const thoughtDiv = document.createElement('div');
    thoughtDiv.style.cssText = [
      'position:absolute;',
      'background:rgba(255,255,255,0.1);color:#ccc;',
      'border:1.5px dashed rgba(255,255,255,0.35);',
      'border-radius:10px;padding:5px 11px;',
      "font-family:system-ui,sans-serif;font-size:12px;font-style:italic;",
      'max-width:170px;text-align:center;',
      'pointer-events:none;display:none;',
      'white-space:nowrap;',
      'transform:translate(-50%,-100%);',
      'backdrop-filter:blur(2px);',
    ].join('');

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = [
      'position:absolute;',
      `color:${c.color};`,
      "font-family:'Courier New',monospace;font-size:10px;font-weight:bold;",
      'pointer-events:none;display:none;',
      'text-shadow:0 1px 4px rgba(0,0,0,0.9);',
      'transform:translate(-50%,-100%);',
      'letter-spacing:0.08em;',
      'text-transform:uppercase;',
    ].join('');
    nameDiv.textContent = c.name;

    bubbleLayer.appendChild(sayDiv);
    bubbleLayer.appendChild(thoughtDiv);
    bubbleLayer.appendChild(nameDiv);
    bubbleDivs[c.name] = { say: sayDiv, thought: thoughtDiv, name: nameDiv };
  }

  // ---- ORBIT CONTROLS ----
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.target.set(space.w / 2, 0, space.h / 2);
  controls.minDistance = 2;
  controls.maxDistance = 60;

  let currentShot = 'wide';
  let isFreeCam = false;

  controls.addEventListener('start', () => {
    isFreeCam = true;
    shotLabel.textContent = 'FREE · ' + take.title;
  });

  // ---- CAMERA TRANSITION ----
  const camTrans = {
    fromPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    t: 1,
    dur: 0.8,
  };

  function startTransition(toPos, toTarget, dur = 0.8) {
    camTrans.fromPos.copy(camera.position);
    camTrans.fromTarget.copy(controls.target);
    camTrans.toPos.copy(toPos);
    camTrans.toTarget.copy(toTarget);
    camTrans.t = 0;
    camTrans.dur = dur;
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  // ---- PLAYBACK STATE ----
  let currentTick = 0;
  let tickFrac = 0;
  let playing = false;
  let lastTime = null;
  const TICK_DUR = 2.2;

  // ---- HELPERS ----
  function lerp(a, b, t) { return a + (b - a) * t; }

  function getActorPos(name, tickIdx, frac) {
    const t0 = ticks[tickIdx];
    const t1 = ticks[Math.min(tickIdx + 1, ticks.length - 1)];
    const a0 = t0?.actors[name];
    const a1 = t1?.actors[name];
    if (!a0) return null;
    return {
      x: lerp(a0.x, a1 ? a1.x : a0.x, frac),
      z: lerp(a0.y, a1 ? a1.y : a0.y, frac),
    };
  }

  function getSpeaker(tickIdx) {
    const tick = ticks[tickIdx];
    if (!tick) return null;
    for (const [name, a] of Object.entries(tick.actors)) {
      if (a.say && a.say.trim()) return name;
    }
    return null;
  }

  function updatePositions(tickIdx, frac) {
    for (const c of cast) {
      const pos = getActorPos(c.name, tickIdx, frac);
      if (pos) actorMeshes[c.name].group.position.set(pos.x, 0, pos.z);
    }
  }

  // ---- PROJECT TO SCREEN ----
  const _v3 = new THREE.Vector3();

  function project(worldPos) {
    _v3.copy(worldPos).project(camera);
    const w = container.clientWidth;
    const h = container.clientHeight;
    return {
      x: ((_v3.x + 1) / 2) * w,
      y: (-((_v3.y - 1) / 2)) * h,
      behind: _v3.z >= 1,
    };
  }

  // ---- BUBBLES ----
  function updateBubbles(tickIdx) {
    const tick = ticks[tickIdx];
    if (!tick) return;

    for (const c of cast) {
      const actor = tick.actors[c.name];
      const divs = bubbleDivs[c.name];
      const mesh = actorMeshes[c.name];

      if (!actor || !mesh) {
        divs.say.style.display = 'none';
        divs.thought.style.display = 'none';
        divs.name.style.display = 'none';
        continue;
      }

      const headWorld = new THREE.Vector3();
      mesh.head.getWorldPosition(headWorld);
      const p = project(headWorld);

      if (p.behind) {
        divs.say.style.display = 'none';
        divs.thought.style.display = 'none';
        divs.name.style.display = 'none';
        continue;
      }

      // Name label: just above head
      divs.name.style.display = 'block';
      divs.name.style.left = p.x + 'px';
      divs.name.style.top = (p.y - 6) + 'px';

      // Speech bubble: above name
      let yOffset = 28;

      if (actor.say && actor.say.trim()) {
        divs.say.style.display = 'block';
        divs.say.textContent = actor.say;
        divs.say.style.left = p.x + 'px';
        divs.say.style.top = (p.y - yOffset) + 'px';
        yOffset += divs.say.offsetHeight + 6;
      } else {
        divs.say.style.display = 'none';
      }

      if (actor.thought && actor.thought.trim()) {
        divs.thought.style.display = 'block';
        divs.thought.textContent = actor.thought;
        divs.thought.style.left = p.x + 'px';
        divs.thought.style.top = (p.y - yOffset) + 'px';
      } else {
        divs.thought.style.display = 'none';
      }
    }
  }

  // ---- HUD ----
  let recPulse = true;
  function updateHUD(tickIdx) {
    const elapsed = tickIdx * TICK_DUR;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
    const ff = String(Math.floor((tickFrac * TICK_DUR * 30) % 30)).padStart(2, '0');
    timecode.textContent = `${mm}:${ss}:${ff}`;

    // Pulse REC dot when playing
    if (playing) {
      recPulse = (Math.floor(performance.now() / 500) % 2 === 0);
      recDot.style.opacity = recPulse ? '1' : '0.25';
    } else {
      recDot.style.opacity = '0.4';
    }
  }

  // ---- SHOT COMPUTATION ----
  const cx = space.w / 2;
  const cz = space.h / 2;

  function computeShot(name, tickIdx) {
    const D = Math.max(space.w, space.h);

    if (name === 'wide') {
      return {
        pos: new THREE.Vector3(cx - D * 0.15, D * 0.82, cz + D * 0.68),
        tgt: new THREE.Vector3(cx, 0.4, cz),
      };
    }

    if (name === 'top') {
      return {
        pos: new THREE.Vector3(cx + 0.001, D * 1.05, cz + 0.001),
        tgt: new THREE.Vector3(cx, 0, cz),
      };
    }

    // Find speaker
    const spName = getSpeaker(tickIdx) || cast[0].name;
    const spMesh = actorMeshes[spName];
    const spPos = spMesh.group.position;

    if (name === 'closeup') {
      // Low angle, close, slight orbit around speaker
      const toCenter = new THREE.Vector3(cx - spPos.x, 0, cz - spPos.z).normalize();
      const side = new THREE.Vector3().crossVectors(toCenter, new THREE.Vector3(0, 1, 0)).multiplyScalar(0.8);
      const camPos = spPos.clone()
        .add(toCenter.clone().multiplyScalar(-2.8))
        .add(side)
        .add(new THREE.Vector3(0, 1.2, 0));
      return {
        pos: camPos,
        tgt: spPos.clone().add(new THREE.Vector3(0, 1.4, 0)),
      };
    }

    if (name === 'ots') {
      // Find nearest other actor
      let nearName = null;
      let nearDist = Infinity;
      for (const c of cast) {
        if (c.name === spName) continue;
        const d = actorMeshes[c.name].group.position.distanceTo(spPos);
        if (d < nearDist) { nearDist = d; nearName = c.name; }
      }
      const lookAt = nearName
        ? actorMeshes[nearName].group.position.clone().setY(1.4)
        : new THREE.Vector3(cx, 1.0, cz);

      const toTarget = lookAt.clone().sub(spPos).normalize();
      const camPos = spPos.clone()
        .sub(toTarget.clone().multiplyScalar(1.3))
        .add(new THREE.Vector3(0, 1.65, 0));
      return { pos: camPos, tgt: lookAt };
    }

    return {
      pos: new THREE.Vector3(cx, D * 0.8, cz + D * 0.6),
      tgt: new THREE.Vector3(cx, 0, cz),
    };
  }

  // ---- setShot ----
  function setShot(name) {
    isFreeCam = (name === 'free');
    if (!isFreeCam) {
      currentShot = name;
      const shot = computeShot(name, currentTick);
      startTransition(shot.pos, shot.tgt);
      const labels = { wide: 'WIDE', closeup: 'CLOSEUP', ots: 'OTS', top: 'TOP' };
      shotLabel.textContent = `SHOT ${labels[name] || name.toUpperCase()} · ${take.title}`;
    } else {
      shotLabel.textContent = 'FREE · ' + take.title;
    }
  }

  // ---- RESIZE ----
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // ---- INIT CAMERA ----
  {
    const shot = computeShot('wide', 0);
    camera.position.copy(shot.pos);
    controls.target.copy(shot.tgt);
    controls.update();
    camTrans.t = 1;
    shotLabel.textContent = `SHOT WIDE · ${take.title}`;
  }

  updatePositions(0, 0);

  // ---- MAIN LOOP ----
  let rafId = null;
  let _recording = false;
  let _compositeCtx = null;
  let _compositeCanvas = null;

  function animate(now) {
    rafId = requestAnimationFrame(animate);

    // Tick advance
    if (playing) {
      if (lastTime === null) { lastTime = now; }
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      tickFrac += dt / TICK_DUR;

      while (tickFrac >= 1) {
        tickFrac -= 1;
        currentTick++;
        if (currentTick >= ticks.length) {
          if (loop) {
            currentTick = 0;
          } else {
            currentTick = ticks.length - 1;
            tickFrac = 0;
            playing = false;
            lastTime = null;
          }
        }
        onTick?.(ticks[currentTick].t);

        // Update dynamic shots when speaker changes
        if (!isFreeCam && (currentShot === 'closeup' || currentShot === 'ots')) {
          const shot = computeShot(currentShot, currentTick);
          startTransition(shot.pos, shot.tgt, 0.6);
        }
      }
    }

    updatePositions(currentTick, tickFrac);

    // Camera transition
    if (camTrans.t < 1) {
      camTrans.t = Math.min(1, camTrans.t + (1 / 60) / camTrans.dur);
      const e = easeInOut(camTrans.t);
      camera.position.lerpVectors(camTrans.fromPos, camTrans.toPos, e);
      controls.target.lerpVectors(camTrans.fromTarget, camTrans.toTarget, e);
    }
    controls.update();

    renderer.render(scene, camera);
    updateBubbles(currentTick);
    updateHUD(currentTick);

    // Recording: composite frame
    if (_recording && _compositeCtx && _compositeCanvas) {
      _compositeCtx.drawImage(canvas, 0, 0, _compositeCanvas.width, _compositeCanvas.height);
      _drawBubblesOnCanvas(_compositeCtx, _compositeCanvas.width, _compositeCanvas.height);
      _drawHUDOnCanvas(_compositeCtx, _compositeCanvas.width, _compositeCanvas.height);
    }
  }

  rafId = requestAnimationFrame(animate);

  // Initial synchronous render so CDP / headless screenshots see content immediately
  renderer.render(scene, camera);
  updateBubbles(0);
  updateHUD(0);

  // ---- CANVAS BUBBLE DRAW (for recording) ----
  function _rpx(cssX, dpr) { return cssX * dpr; }
  function _rpy(cssY, dpr) { return cssY * dpr; }

  function _drawBubblesOnCanvas(ctx, cw, ch) {
    const dpr = cw / container.clientWidth;
    const tick = ticks[currentTick];
    if (!tick) return;

    for (const c of cast) {
      const actor = tick.actors[c.name];
      const mesh = actorMeshes[c.name];
      if (!actor || !mesh) continue;

      const headWorld = new THREE.Vector3();
      mesh.head.getWorldPosition(headWorld);
      const p = project(headWorld);
      if (p.behind) continue;

      const sx = _rpx(p.x, dpr);
      const sy = _rpy(p.y, dpr);

      // Name
      ctx.font = `bold ${Math.round(10 * dpr)}px "Courier New", monospace`;
      ctx.fillStyle = c.color;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 3 * dpr;
      ctx.fillText(c.name.toUpperCase(), sx, sy - 6 * dpr);
      ctx.shadowBlur = 0;

      let yOff = 28 * dpr;

      if (actor.say && actor.say.trim()) {
        yOff += _drawTextBubble(ctx, actor.say, sx, sy - yOff, false, dpr);
      }
      if (actor.thought && actor.thought.trim()) {
        _drawTextBubble(ctx, actor.thought, sx, sy - yOff, true, dpr);
      }
    }
  }

  function _drawTextBubble(ctx, text, x, y, isDashed, dpr) {
    const fs = Math.round(12 * dpr);
    ctx.font = isDashed ? `italic ${fs}px system-ui, sans-serif` : `${fs}px system-ui, sans-serif`;
    const pad = 10 * dpr;
    const tw = ctx.measureText(text).width + pad * 2;
    const th = 24 * dpr;

    if (isDashed) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5 * dpr;
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.setLineDash([]);
    }

    _roundRect(ctx, x - tw / 2, y - th, tw, th, 7 * dpr);
    ctx.fill();
    if (isDashed) ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = isDashed ? '#ccc' : '#111';
    ctx.textAlign = 'center';
    ctx.font = isDashed ? `italic ${fs}px system-ui, sans-serif` : `${fs}px system-ui, sans-serif`;
    ctx.fillText(text, x, y - th / 2 + 4 * dpr);
    return th + 6 * dpr;
  }

  function _drawHUDOnCanvas(ctx, cw, ch) {
    const dpr = cw / container.clientWidth;
    const pad = 14 * dpr;
    const boxH = 34 * dpr;
    const boxW = 230 * dpr;
    const x = 14 * dpr;
    const y = 14 * dpr;

    ctx.fillStyle = 'rgba(10,11,14,0.72)';
    _roundRect(ctx, x, y, boxW, boxH, 7 * dpr);
    ctx.fill();

    // REC dot
    ctx.fillStyle = (Math.floor(performance.now() / 500) % 2 === 0) ? '#e74c3c' : 'rgba(231,76,60,0.25)';
    ctx.beginPath();
    ctx.arc(x + pad, y + boxH / 2, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();

    // Label + timecode
    const elapsed = currentTick * TICK_DUR;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
    const ff = String(Math.floor((tickFrac * TICK_DUR * 30) % 30)).padStart(2, '0');

    const labels = { wide: 'WIDE', closeup: 'CLOSEUP', ots: 'OTS', top: 'TOP', free: 'FREE' };
    const name = isFreeCam ? 'FREE' : (labels[currentShot] || currentShot.toUpperCase());

    ctx.font = `${Math.round(12 * dpr)}px "Courier New", monospace`;
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'left';
    ctx.fillText(`SHOT ${name}  ${mm}:${ss}:${ff}`, x + pad * 1.8, y + boxH / 2 + 4 * dpr);
  }

  function _roundRect(ctx, rx, ry, rw, rh, rr) {
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + rw - rr, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr);
    ctx.lineTo(rx + rw, ry + rh - rr);
    ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr);
    ctx.lineTo(rx + rr, ry + rh);
    ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr);
    ctx.lineTo(rx, ry + rr);
    ctx.arcTo(rx, ry, rx + rr, ry, rr);
    ctx.closePath();
  }

  // ---- RECORD ----
  async function record(seconds) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cw = container.clientWidth * dpr;
    const ch = container.clientHeight * dpr;

    _compositeCanvas = document.createElement('canvas');
    _compositeCanvas.width = cw;
    _compositeCanvas.height = ch;
    _compositeCtx = _compositeCanvas.getContext('2d');

    const stream = _compositeCanvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve) => {
      recorder.onstop = () => {
        _recording = false;
        _compositeCanvas = null;
        _compositeCtx = null;
        resolve(new Blob(chunks, { type: 'video/webm' }));
      };

      recorder.start(100); // 100ms timeslice
      _recording = true;

      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, seconds * 1000);
    });
  }

  // ---- PUBLIC API ----
  function play() {
    playing = true;
    lastTime = null;
  }

  function pause() {
    playing = false;
    lastTime = null;
  }

  function seek(tickT) {
    const idx = ticks.findIndex((t) => t.t >= tickT);
    currentTick = idx >= 0 ? idx : 0;
    tickFrac = 0;
    updatePositions(currentTick, 0);
    onTick?.(ticks[currentTick].t);
  }

  function destroy() {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (bubbleLayer.parentNode) bubbleLayer.parentNode.removeChild(bubbleLayer);
    if (hud.parentNode) hud.parentNode.removeChild(hud);
  }

  function forceRender() {
    // Advance camera transition (same logic as animate())
    if (camTrans.t < 1) {
      camTrans.t = Math.min(1, camTrans.t + (1 / 60) / camTrans.dur);
      const e = easeInOut(camTrans.t);
      camera.position.lerpVectors(camTrans.fromPos, camTrans.toPos, e);
      controls.target.lerpVectors(camTrans.fromTarget, camTrans.toTarget, e);
    }
    controls.update();
    renderer.render(scene, camera);
    updateBubbles(currentTick);
    updateHUD(currentTick);
  }

  return { play, pause, seek, setShot, record, destroy, forceRender };
}
