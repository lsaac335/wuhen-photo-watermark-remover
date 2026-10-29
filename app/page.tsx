"use client";

import { ChangeEvent, DragEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type BrushStroke = { kind: "brush" | "erase"; points: Point[]; size: number };
type RectStroke = { kind: "rect"; start: Point; end: Point; padding: number };
type Stroke = BrushStroke | RectStroke;
type Tool = "brush" | "rect" | "erase";
type Quality = "fine" | "balanced" | "strong";

const MAX_PIXELS = 20_000_000;

function waitForPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function dilateMask(source: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return source;
  let current = source;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = current.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (current[i]) continue;
        if (current[i - 1] || current[i + 1] || current[i - width] || current[i + width]) next[i] = 1;
      }
    }
    current = next;
  }
  return current;
}

async function repairPixels(
  image: ImageData,
  sourceMask: Uint8Array,
  quality: Quality,
  onProgress: (value: number) => void,
) {
  const { width, height, data } = image;
  const settings = {
    fine: { grow: 1, radius: 3 },
    balanced: { grow: 2, radius: 5 },
    strong: { grow: 3, radius: 8 },
  }[quality];
  const mask = dilateMask(sourceMask, width, height, settings.grow);
  const remaining = mask.slice();
  const queued = new Uint8Array(mask.length);
  const queue: number[] = [];
  let maskedCount = 0;

  const addIfBoundary = (i: number) => {
    if (!remaining[i] || queued[i]) return;
    const x = i % width;
    const y = Math.floor(i / width);
    if (
      (x > 0 && !remaining[i - 1]) ||
      (x < width - 1 && !remaining[i + 1]) ||
      (y > 0 && !remaining[i - width]) ||
      (y < height - 1 && !remaining[i + width])
    ) {
      queued[i] = 1;
      queue.push(i);
    }
  };

  for (let i = 0; i < remaining.length; i += 1) {
    if (remaining[i]) {
      maskedCount += 1;
      addIfBoundary(i);
    }
  }
  if (!maskedCount) return image;

  let cursor = 0;
  while (cursor < queue.length) {
    const i = queue[cursor++];
    if (!remaining[i]) continue;
    const cx = i % width;
    const cy = Math.floor(i / width);
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let weights = 0;

    for (let dy = -settings.radius; dy <= settings.radius; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      for (let dx = -settings.radius; dx <= settings.radius; dx += 1) {
        const x = cx + dx;
        if (x < 0 || x >= width || (dx === 0 && dy === 0)) continue;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > settings.radius * settings.radius) continue;
        const sample = y * width + x;
        if (remaining[sample]) continue;
        const weight = 1 / (1 + distanceSquared);
        const p = sample * 4;
        r += data[p] * weight;
        g += data[p + 1] * weight;
        b += data[p + 2] * weight;
        a += data[p + 3] * weight;
        weights += weight;
      }
    }

    if (weights > 0) {
      const p = i * 4;
      data[p] = Math.round(r / weights);
      data[p + 1] = Math.round(g / weights);
      data[p + 2] = Math.round(b / weights);
      data[p + 3] = Math.round(a / weights);
      remaining[i] = 0;

      if (cx > 0) addIfBoundary(i - 1);
      if (cx < width - 1) addIfBoundary(i + 1);
      if (cy > 0) addIfBoundary(i - width);
      if (cy < height - 1) addIfBoundary(i + width);
    }

    if (cursor % 5000 === 0) {
      onProgress(Math.min(98, Math.round((cursor / Math.max(maskedCount, queue.length)) * 100)));
      await waitForPaint();
    }
  }
  onProgress(100);
  return image;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const activeRef = useRef<Point[]>([]);
  const rectStartRef = useRef<Point | null>(null);
  const rectEndRef = useRef<Point | null>(null);
  const renderRef = useRef<() => void>(() => {});

  const [imageName, setImageName] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(36);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [compare, setCompare] = useState(false);
  const [compareAt, setCompareAt] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("照片只在你的设备上处理，不会上传");
  const [hasRepairs, setHasRepairs] = useState(false);

  const hasImage = imageSize.width > 0;

  const rebuildMask = useCallback((allStrokes: Stroke[], active?: Stroke) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const paint = (stroke: Stroke) => {
      ctx.globalCompositeOperation = stroke.kind === "erase" ? "destination-out" : "source-over";
      ctx.fillStyle = "rgba(255, 76, 113, 1)";
      ctx.strokeStyle = "rgba(255, 76, 113, 1)";
      if (stroke.kind === "rect") {
        const left = Math.min(stroke.start.x, stroke.end.x) - stroke.padding;
        const top = Math.min(stroke.start.y, stroke.end.y) - stroke.padding;
        const width = Math.abs(stroke.end.x - stroke.start.x) + stroke.padding * 2;
        const height = Math.abs(stroke.end.y - stroke.start.y) + stroke.padding * 2;
        ctx.fillRect(left, top, width, height);
        return;
      }
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
    };

    allStrokes.forEach(paint);
    if (active) paint(active);
  }, []);

  const render = useCallback(() => {
    const canvas = viewCanvasRef.current;
    const work = workCanvasRef.current;
    const original = originalCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!canvas || !work || !original || !mask || !imageSize.width) return;

    const stage = canvas.parentElement;
    const maxWidth = Math.max(320, (stage?.clientWidth || 900) - 48);
    const maxHeight = Math.max(300, Math.min(680, window.innerHeight - 250));
    const fit = Math.min(maxWidth / imageSize.width, maxHeight / imageSize.height, 1);
    const displayWidth = Math.round(imageSize.width * fit * zoom);
    const displayHeight = Math.round(imageSize.height * fit * zoom);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(displayWidth * ratio));
    canvas.height = Math.max(1, Math.round(displayHeight * ratio));
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (compare && hasRepairs) {
      ctx.drawImage(work, 0, 0, displayWidth, displayHeight);
      const split = (displayWidth * compareAt) / 100;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, split, displayHeight);
      ctx.clip();
      ctx.drawImage(original, 0, 0, displayWidth, displayHeight);
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,.94)";
      ctx.fillRect(split - 1, 0, 2, displayHeight);
      ctx.beginPath();
      ctx.arc(split, displayHeight / 2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#242523";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("↔", split, displayHeight / 2 + 5);
    } else {
      ctx.drawImage(work, 0, 0, displayWidth, displayHeight);
      if (strokes.length || drawingRef.current) {
        ctx.save();
        ctx.globalAlpha = 0.48;
        ctx.drawImage(mask, 0, 0, displayWidth, displayHeight);
        ctx.restore();
      }
    }
  }, [compare, compareAt, hasRepairs, imageSize, strokes.length, zoom]);

  useEffect(() => {
    renderRef.current = render;
    render();
  }, [render]);

  useEffect(() => {
    const onResize = () => renderRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const loadFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    setIsBusy(true);
    setNotice("正在读取照片…");
    try {
      const bitmap = await createImageBitmap(file);
      let width = bitmap.width;
      let height = bitmap.height;
      if (width * height > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / (width * height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        setNotice("超大照片已智能缩放，便于流畅处理");
      } else {
        setNotice("用画笔或矩形覆盖水印，然后点击「立即修复」");
      }
      const makeCanvas = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      };
      const work = makeCanvas();
      const original = makeCanvas();
      const mask = makeCanvas();
      work.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      original.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      workCanvasRef.current = work;
      originalCanvasRef.current = original;
      maskCanvasRef.current = mask;
      setImageName(file.name.replace(/\.[^.]+$/, ""));
      setImageSize({ width, height });
      setStrokes([]);
      setRedoStack([]);
      setHasRepairs(false);
      setCompare(false);
      setZoom(1);
      requestAnimationFrame(() => renderRef.current());
    } catch {
      setNotice("这张照片无法读取，请换一张试试");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const canvasPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * imageSize.width,
      y: ((event.clientY - rect.top) / rect.height) * imageSize.height,
    };
  };

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage || isBusy || compare) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = canvasPoint(event);
    if (tool === "rect") {
      rectStartRef.current = point;
      rectEndRef.current = point;
      rebuildMask(strokes, { kind: "rect", start: point, end: point, padding: brushSize / 2 });
    } else {
      activeRef.current = [point];
      rebuildMask(strokes, { kind: tool, points: [point], size: brushSize });
    }
    renderRef.current();
  };

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !hasImage) return;
    const point = canvasPoint(event);
    if (tool === "rect" && rectStartRef.current) {
      rectEndRef.current = point;
      rebuildMask(strokes, { kind: "rect", start: rectStartRef.current, end: point, padding: brushSize / 2 });
    } else {
      activeRef.current.push(point);
      rebuildMask(strokes, { kind: tool as "brush" | "erase", points: activeRef.current, size: brushSize });
    }
    renderRef.current();
  };

  const pointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    let stroke: Stroke | null = null;
    if (tool === "rect" && rectStartRef.current && rectEndRef.current) {
      stroke = { kind: "rect", start: rectStartRef.current, end: rectEndRef.current, padding: brushSize / 2 };
    } else if (activeRef.current.length) {
      stroke = { kind: tool as "brush" | "erase", points: [...activeRef.current], size: brushSize };
    }
    activeRef.current = [];
    rectStartRef.current = null;
    rectEndRef.current = null;
    if (stroke) {
      const next = [...strokes, stroke];
      setStrokes(next);
      setRedoStack([]);
      rebuildMask(next);
    }
    requestAnimationFrame(() => renderRef.current());
  };

  const undo = () => {
    if (!strokes.length) return;
    const next = strokes.slice(0, -1);
    setRedoStack((current) => [strokes[strokes.length - 1], ...current]);
    setStrokes(next);
    rebuildMask(next);
  };

  const redo = () => {
    if (!redoStack.length) return;
    const next = [...strokes, redoStack[0]];
    setStrokes(next);
    setRedoStack(redoStack.slice(1));
    rebuildMask(next);
  };

  const repair = async () => {
    const work = workCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!work || !maskCanvas || !strokes.length) {
      setNotice("先用画笔或矩形把水印完整覆盖住");
      return;
    }
    const workCtx = work.getContext("2d", { willReadFrequently: true });
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!workCtx || !maskCtx) return;
    setIsBusy(true);
    setProgress(2);
    setNotice("正在分析水印周围的颜色和纹理…");
    await waitForPaint();
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    const maskPixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const mask = new Uint8Array(work.width * work.height);
    let selected = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (maskPixels[i * 4 + 3] > 20) {
        mask[i] = 1;
        selected += 1;
      }
    }
    if (!selected) {
      setIsBusy(false);
      setNotice("没有可修复的标记区域");
      return;
    }
    const repaired = await repairPixels(image, mask, quality, setProgress);
    workCtx.putImageData(repaired, 0, 0);
    setStrokes([]);
    setRedoStack([]);
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    setHasRepairs(true);
    setIsBusy(false);
    setProgress(0);
    setNotice("修复完成！可以拖动对比滑块检查效果");
    requestAnimationFrame(() => renderRef.current());
  };

  const reset = () => {
    const work = workCanvasRef.current;
    const original = originalCanvasRef.current;
    if (!work || !original) return;
    const ctx = work.getContext("2d");
    ctx?.clearRect(0, 0, work.width, work.height);
    ctx?.drawImage(original, 0, 0);
    setStrokes([]);
    setRedoStack([]);
    rebuildMask([]);
    setHasRepairs(false);
    setCompare(false);
    setNotice("已恢复到原图");
  };

  const download = async (format: "png" | "jpeg") => {
    const work = workCanvasRef.current;
    if (!work) return;
    const fileName = `${imageName || "修复后照片"}-已去水印.${format === "png" ? "png" : "jpg"}`;
    const dataUrl = work.toDataURL(`image/${format}`, format === "jpeg" ? 0.94 : undefined);
    const desktopApi = (window as Window & {
      desktopAPI?: { saveImage: (payload: { dataUrl: string; fileName: string }) => Promise<boolean> };
    }).desktopAPI;
    if (desktopApi) {
      const saved = await desktopApi.saveImage({ dataUrl, fileName });
      if (saved) setNotice(`已导出 ${format === "png" ? "PNG" : "JPG"} 照片`);
      return;
    }
    const link = document.createElement("a");
    link.download = fileName;
    link.href = dataUrl;
    link.click();
    setNotice(`已导出 ${format === "png" ? "PNG" : "JPG"} 照片`);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files[0]);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>无痕修图</span>
          <span className="local-badge">本地处理</span>
        </div>
        <div className="privacy-note"><span className="status-dot" /> 照片不上传，隐私更安心</div>
      </header>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="panel-heading">
            <span className="eyebrow">01 · 选择照片</span>
            <button className="text-action" onClick={() => fileInputRef.current?.click()}>{hasImage ? "更换" : "选择"}</button>
          </div>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event: ChangeEvent<HTMLInputElement>) => loadFile(event.target.files?.[0])}
          />
          {hasImage ? (
            <div className="file-card">
              <div className="file-icon">IMG</div>
              <div className="file-copy"><strong>{imageName}</strong><span>{imageSize.width} × {imageSize.height} px</span></div>
              <span className="check">✓</span>
            </div>
          ) : (
            <button className="upload-mini" onClick={() => fileInputRef.current?.click()}>
              <span>+</span>打开一张照片
            </button>
          )}

          <div className="divider" />
          <span className="eyebrow">02 · 标记水印</span>
          <div className="tool-grid" role="group" aria-label="标记工具">
            <button className={tool === "brush" ? "active" : ""} onClick={() => setTool("brush")}><span className="tool-symbol brush-symbol" />画笔</button>
            <button className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")}><span className="tool-symbol rect-symbol" />矩形</button>
            <button className={tool === "erase" ? "active" : ""} onClick={() => setTool("erase")}><span className="tool-symbol eraser-symbol" />擦除</button>
          </div>

          <label className="range-label"><span>画笔大小</span><output>{brushSize}px</output></label>
          <input className="range" type="range" min="8" max="160" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
          <div className="history-row">
            <button disabled={!strokes.length} onClick={undo}>↶ 撤销</button>
            <button disabled={!redoStack.length} onClick={redo}>↷ 重做</button>
            <button disabled={!strokes.length} onClick={() => { setStrokes([]); rebuildMask([]); }}>清空</button>
          </div>

          <div className="divider" />
          <span className="eyebrow">03 · 修复效果</span>
          <div className="quality-options">
            {([
              ["fine", "精细", "细小文字"],
              ["balanced", "平衡", "大多数照片"],
              ["strong", "强力", "宽边水印"],
            ] as const).map(([value, label, hint]) => (
              <button key={value} className={quality === value ? "active" : ""} onClick={() => setQuality(value)}>
                <span>{label}</span><small>{hint}</small>
              </button>
            ))}
          </div>
          <button className="repair-button" disabled={!hasImage || isBusy} onClick={repair}>
            <span className="sparkle">✦</span>{isBusy ? `正在修复 ${progress}%` : "立即修复"}
          </button>
          {isBusy && <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>}
        </aside>

        <section className="editor-column">
          <div className="editor-toolbar">
            <div className="zoom-controls">
              <button disabled={!hasImage || zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button disabled={!hasImage || zoom >= 2.5} onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>+</button>
              <button disabled={!hasImage} onClick={() => setZoom(1)}>适应</button>
            </div>
            <div className="edit-actions">
              <button disabled={!hasRepairs} className={compare ? "active" : ""} onClick={() => setCompare((value) => !value)}>◐ 对比</button>
              <button disabled={!hasRepairs && !strokes.length} onClick={reset}>↺ 还原</button>
            </div>
          </div>

          <div
            className={`canvas-stage ${dragging ? "dragging" : ""} ${hasImage ? "has-image" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {!hasImage ? (
              <button className="empty-state" onClick={() => fileInputRef.current?.click()}>
                <span className="drop-visual"><i className="photo-shape" /><i className="drop-plus">+</i></span>
                <strong>拖入照片，开始去水印</strong>
                <span>或点击选择 JPG、PNG、WebP</span>
                <em>选择照片</em>
              </button>
            ) : (
              <div className="canvas-scroll">
                <canvas
                  ref={viewCanvasRef}
                  className={`image-canvas tool-${tool}`}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={pointerUp}
                />
                {compare && hasRepairs && (
                  <input
                    aria-label="前后对比"
                    className="compare-slider"
                    type="range"
                    min="0"
                    max="100"
                    value={compareAt}
                    onChange={(event) => setCompareAt(Number(event.target.value))}
                  />
                )}
              </div>
            )}
            {dragging && <div className="drop-overlay">松开即可打开照片</div>}
          </div>
          <div className="notice-bar"><span className="tip-icon">i</span>{notice}</div>
        </section>

        <aside className="panel export-panel">
          <span className="eyebrow">04 · 导出照片</span>
          <div className={`result-preview ${hasRepairs ? "ready" : ""}`}>
            <span>{hasRepairs ? "✓" : "✦"}</span>
            <strong>{hasRepairs ? "修复完成" : "等待修复"}</strong>
            <small>{hasRepairs ? "照片已可导出" : "完成后可保存图片"}</small>
          </div>
          <p className="export-hint">PNG 适合保留最高画质，JPG 文件更小、分享更方便。</p>
          <button className="export-primary" disabled={!hasImage || isBusy} onClick={() => download("png")}>
            <span>↓</span>保存 PNG
          </button>
          <button className="export-secondary" disabled={!hasImage || isBusy} onClick={() => download("jpeg")}>保存 JPG</button>
          <div className="privacy-card">
            <span className="lock-shape" />
            <div><strong>隐私保护</strong><p>所有处理都在本机完成，关闭页面后照片不会被保留。</p></div>
          </div>
        </aside>
      </section>

      <footer><span>小技巧：标记范围比水印边缘多覆盖一点，修复会更自然。</span><span>请仅处理你拥有或已获授权的照片</span></footer>
    </main>
  );
}
