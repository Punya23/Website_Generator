// Soft, ambient three.js backdrop for the playground.
// Purely decorative: fixed behind the UI, no pointer events, low motion,
// and skipped entirely for reduced-motion or missing WebGL.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const canvas = document.getElementById("bg-canvas");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (canvas && !reduceMotion) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    renderer = null;
  }

  if (renderer) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 20;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // A loose field of warm, softly glowing points drifting behind the glass panels.
    const count = 140;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 42;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
      speeds[i] = 0.15 + Math.random() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xb9834a,
      size: 0.11,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Two large, near-invisible gradient spheres for depth — barely-there color blobs.
    const blobGeo = new THREE.SphereGeometry(9, 32, 32);
    const blobMatA = new THREE.MeshBasicMaterial({ color: 0xf0c896, transparent: true, opacity: 0.05 });
    const blobA = new THREE.Mesh(blobGeo, blobMatA);
    blobA.position.set(-10, 4, -12);
    scene.add(blobA);

    const blobMatB = new THREE.MeshBasicMaterial({ color: 0x7c8f7a, transparent: true, opacity: 0.045 });
    const blobB = new THREE.Mesh(blobGeo, blobMatB);
    blobB.position.set(11, -5, -14);
    scene.add(blobB);

    const clock = new THREE.Clock();
    let frame;
    let visible = true;

    function animate() {
      frame = requestAnimationFrame(animate);
      if (!visible) return;
      const t = clock.getElapsedTime();
      points.rotation.y = t * 0.02;
      points.rotation.x = Math.sin(t * 0.08) * 0.05;
      blobA.position.y = 4 + Math.sin(t * 0.12) * 1.2;
      blobB.position.y = -5 + Math.cos(t * 0.1) * 1.2;
      renderer.render(scene, camera);
    }
    animate();

    document.addEventListener("visibilitychange", () => {
      visible = document.visibilityState === "visible";
    });

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }
}
