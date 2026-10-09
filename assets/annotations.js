export function emptyNotebook() { return { version: 1, lastPage: 1, pages: {} }; }

export function storageKey(file) { return `presentation-shelf:v1:${file.id}:${file.revision}`; }

export function parseNotebook(raw, pageCount) {
  if (!raw) return emptyNotebook();
  const input = JSON.parse(raw);
  if (input?.version !== 1 || !input.pages || typeof input.pages !== 'object' || Array.isArray(input.pages)) throw new Error('Invalid saved annotations');
  const result = emptyNotebook();
  result.lastPage = Math.max(1, Math.min(pageCount, Math.trunc(Number(input.lastPage) || 1)));
  for (const [number, page] of Object.entries(input.pages)) {
    if (!/^\d+$/.test(number) || Number(number) < 1 || Number(number) > pageCount || !page || typeof page !== 'object') continue;
    const strokes = Array.isArray(page.strokes) ? page.strokes.filter(stroke => {
      return ['pen', 'highlight'].includes(stroke?.type) && /^#[a-f0-9]{6}$/i.test(stroke.color) && Number.isFinite(stroke.width) && stroke.width > 0 && stroke.width <= .1 && Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 20000 && stroke.points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    }).slice(0, 500) : [];
    result.pages[number] = { notes: typeof page.notes === 'string' ? page.notes.slice(0, 50000) : '', strokes };
  }
  return result;
}

export function drawAnnotations(context, strokes, width, height) {
  context.clearRect(0, 0, width, height);
  for (const stroke of strokes) {
    context.save();
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width * width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (stroke.type === 'highlight') {
      const first = stroke.points[0];
      const last = stroke.points.at(-1);
      context.globalAlpha = .3;
      context.fillRect(Math.min(first[0], last[0]) * width, Math.min(first[1], last[1]) * height, Math.abs(last[0] - first[0]) * width, Math.abs(last[1] - first[1]) * height);
    } else if (stroke.points.length === 1) {
      context.beginPath();
      context.arc(stroke.points[0][0] * width, stroke.points[0][1] * height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      stroke.points.forEach(([x, y], index) => index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height));
      context.stroke();
    }
    context.restore();
  }
}

function distanceToSegment(point, first, last) {
  const dx = last[0] - first[0], dy = last[1] - first[1];
  const denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / denominator)) : 0;
  return Math.hypot(point[0] - first[0] - t * dx, point[1] - first[1] - t * dy);
}

export function findStrokeAt(strokes, point, width, height, radius = 14) {
  const pixelPoint = [point[0] * width, point[1] * height];
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index];
    if (stroke.type === 'highlight') {
      const a = stroke.points[0], b = stroke.points.at(-1);
      if (point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return index;
    } else {
      const points = stroke.points.map(([x, y]) => [x * width, y * height]);
      if (points.length === 1 && distanceToSegment(pixelPoint, points[0], points[0]) <= radius + stroke.width * width / 2) return index;
      for (let i = 1; i < points.length; i++) if (distanceToSegment(pixelPoint, points[i - 1], points[i]) <= radius + stroke.width * width / 2) return index;
    }
  }
  return -1;
}
