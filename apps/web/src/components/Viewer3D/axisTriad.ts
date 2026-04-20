import * as THREE from 'three';

export function createAxisScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const length = 1.8;
  const addArrow = (color: number, dir: 'x' | 'y' | 'z') => {
    const mat = new THREE.MeshBasicMaterial({ color });
    const shaft = new THREE.CylinderGeometry(0.06, 0.06, length, 6);
    const tip = new THREE.ConeGeometry(0.15, 0.4, 8);
    if (dir === 'x') {
      shaft.rotateZ(-Math.PI / 2);
      shaft.translate(length / 2, 0, 0);
      tip.rotateZ(-Math.PI / 2);
      tip.translate(length + 0.15, 0, 0);
    } else if (dir === 'z') {
      shaft.rotateX(Math.PI / 2);
      shaft.translate(0, 0, length / 2);
      tip.rotateX(Math.PI / 2);
      tip.translate(0, 0, length + 0.15);
    } else {
      shaft.translate(0, length / 2, 0);
      tip.translate(0, length + 0.15, 0);
    }
    scene.add(new THREE.Mesh(shaft, mat));
    scene.add(new THREE.Mesh(tip, mat));
  };
  addArrow(0xff3333, 'x');
  addArrow(0x33cc33, 'y');
  addArrow(0x3388ff, 'z');
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x888888 }),
    ),
  );
  return scene;
}
