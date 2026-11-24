function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

export function buildMeshSegments(landmarks, connections) {
  const points = Array.isArray(landmarks) ? landmarks : [];
  const edges = Array.isArray(connections) ? connections : [];
  const segments = [];
  for (const edge of edges) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const a = points[start];
    const b = points[end];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
  }
  return segments;
}

export function buildMeshTriangles(connections) {
  const edges = Array.isArray(connections) ? connections : [];
  const adjacency = new Map();
  for (const edge of edges) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) continue;
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start).add(end);
    adjacency.get(end).add(start);
  }
  const seen = new Set();
  const triangles = [];
  for (const [start, neighbors] of adjacency) {
    for (const end of neighbors) {
      if (end <= start) continue;
      const endNeighbors = adjacency.get(end);
      for (const third of neighbors) {
        if (!endNeighbors.has(third)) continue;
        const triangle = [start, end, third].sort((a, b) => a - b);
        const key = triangle.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        triangles.push(triangle);
      }
    }
  }
  return triangles;
}

export function drawFaceMesh(context, faces, {
  connections,
  width,
  height,
  lineColor = '#59d2ff',
  lineAlpha = 0.55,
  fillAlpha = 0.08,
  lineWidth = 1,
} = {}) {
  if (!(width > 0) || !(height > 0)) return 0;
  const list = Array.isArray(faces) ? faces : [];
  const perFace = list.map((face) => buildMeshSegments(face?.landmarks, connections));
  const total = perFace.reduce((sum, segments) => sum + segments.length, 0);
  const triangles = buildMeshTriangles(connections);

  context.save();
  context.globalAlpha = lineAlpha;
  context.strokeStyle = lineColor;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (const segments of perFace) {
    for (const { a, b } of segments) {
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
    }
  }
  context.stroke();

  if (triangles.length) {
    context.globalAlpha = fillAlpha;
    context.fillStyle = lineColor;
    context.beginPath();
    for (const face of list) {
      const landmarks = face?.landmarks;
      if (!Array.isArray(landmarks)) continue;
      for (const triangle of triangles) {
        const points = triangle.map((index) => landmarks[index]);
        if (!points.every(finitePoint)) continue;
        context.moveTo(points[0].x * width, points[0].y * height);
        context.lineTo(points[1].x * width, points[1].y * height);
        context.lineTo(points[2].x * width, points[2].y * height);
        context.closePath();
      }
    }
    context.fill();
  }
  context.restore();

  return total;
}
