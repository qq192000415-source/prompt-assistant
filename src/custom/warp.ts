// 样机智能对象的变形：Photoshop「自定义变形」是 4×4 控制点的双三次贝塞尔曲面（控制点在智能对象自己的像素空间里，行优先），
// 智能对象的四角（Trnf）框的是**变形后图形的外框**，不是智能对象画布：拿客户的抱枕样机实测，按外框对齐后和 PS 合成的平均误差 0.36/255，
// 按画布对齐是 2.77（图案边缘错开几个像素）。主进程和界面共用，Node 测试直接加载本文件。
import { applyHomography, solveHomography, type Point, type Quad } from '../materials/imageEdit.ts';

export type SmartObjectGeometry = {
  // 智能对象画布尺寸（抱枕样机是 4724×4724，正好是 40cm 生产面）。
  width: number;
  height: number;
  // 智能对象四角在样机上的位置：左上、右上、右下、左下。
  quad: Quad;
  // 16 个控制点，行优先；没有变形时为 null。
  mesh: Point[] | null;
};

const bernstein = (t: number): [number, number, number, number] => {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
};

// u、v 在 0–1，返回智能对象像素空间里的点。
export function bezierPatch(mesh: Point[], u: number, v: number): Point {
  const bu = bernstein(u);
  const bv = bernstein(v);
  let x = 0;
  let y = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const weight = bv[row] * bu[col];
      x += weight * mesh[row * 4 + col].x;
      y += weight * mesh[row * 4 + col].y;
    }
  }
  return { x, y };
}

const BOUNDS_STEPS = 32;

// 变形后图形在智能对象空间里的外框；曲面的极值可能落在边内侧，所以整片采样。
export function warpedBounds(mesh: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let row = 0; row <= BOUNDS_STEPS; row += 1) {
    for (let col = 0; col <= BOUNDS_STEPS; col += 1) {
      const { x, y } = bezierPatch(mesh, col / BOUNDS_STEPS, row / BOUNDS_STEPS);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

// 设计图上 (u, v)（0–1）这一点落在样机上的哪里。智能对象带透视扭曲时（nonAffineTransform 不是矩形），
// 要先把 16 个控制点按「外框 → 四角」的透视映射过去，再算贝塞尔曲面；先算曲面再整体透视会错开几个像素（客户第二个样机实测 3.59 vs 7.24，
// 不带透视的样机是 3.06，剩下的是重采样误差）。
export function makeWarp(geometry: SmartObjectGeometry): (u: number, v: number) => Point {
  const { width, height, quad, mesh } = geometry;
  if (!mesh) {
    const toDocument = solveHomography(
      [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      quad,
    );
    return (u, v) => applyHomography(toDocument, u * width, v * height);
  }
  const { minX, minY, maxX, maxY } = warpedBounds(mesh);
  const toDocument = solveHomography(
    [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    quad,
  );
  const placed = mesh.map((point) => applyHomography(toDocument, point.x, point.y));
  return (u, v) => bezierPatch(placed, u, v);
}

// (steps+1)×(steps+1) 个网格点，行优先：points[row * (steps + 1) + col]，界面按格子拆三角形画。
export function warpGrid(geometry: SmartObjectGeometry, steps: number): Point[] {
  const warp = makeWarp(geometry);
  const points: Point[] = [];
  for (let row = 0; row <= steps; row += 1) {
    for (let col = 0; col <= steps; col += 1) points.push(warp(col / steps, row / steps));
  }
  return points;
}

// ---- 用照片做样机时的网格编辑：只拖边上 12 个点（四角 + 每条边两个），中间 4 个按 Coons 曲面从四条边插值，
// 这样四条边怎么弯，里面就均匀地跟着弯，和 PS 变形网格拖边的手感一致。
export const isBorderPoint = (index: number) => {
  const row = Math.floor(index / 4);
  const col = index % 4;
  return row === 0 || row === 3 || col === 0 || col === 3;
};

export function withCoonsInterior(mesh: Point[]): Point[] {
  const at = (row: number, col: number) => mesh[row * 4 + col];
  return mesh.map((point, index) => {
    if (isBorderPoint(index)) return point;
    const row = Math.floor(index / 4);
    const col = index % 4;
    const u = col / 3;
    const v = row / 3;
    const blend = (key: 'x' | 'y') =>
      (1 - v) * at(0, col)[key] +
      v * at(3, col)[key] +
      (1 - u) * at(row, 0)[key] +
      u * at(row, 3)[key] -
      ((1 - u) * (1 - v) * at(0, 0)[key] + u * (1 - v) * at(0, 3)[key] + (1 - u) * v * at(3, 0)[key] + u * v * at(3, 3)[key]);
    return { x: blend('x'), y: blend('y') };
  });
}

// 默认网格：照片中间一块方形，边长取短边的一半。
export function defaultMesh(width: number, height: number): Point[] {
  const side = Math.min(width, height) / 2;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  return Array.from({ length: 16 }, (_, index) => ({ x: left + ((index % 4) / 3) * side, y: top + (Math.floor(index / 4) / 3) * side }));
}
