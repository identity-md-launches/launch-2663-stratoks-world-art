import atlas from "./atlas.json";
export type Sprite = {
  sheet: string;
  rect: number[];
  anchor: number[];
  widthInHalfTiles: number;
};
export const sprites = atlas.sprites as Record<string, Sprite>;
export const wornGround = atlas.presentation.wornGround;
export type Art = Record<string, HTMLImageElement>;
let pending: Promise<Art> | null = null;
export function loadArt(): Promise<Art> {
  return (pending ??= (async () => {
    const entries = await Promise.all(
      Object.entries(atlas.sheets).map(async ([key, sheet]) => {
        const im = new Image();
        im.src = `${import.meta.env.BASE_URL}art/${sheet.file}`;
        await im.decode();
        return [key, im] as const;
      }),
    );
    return Object.fromEntries(entries);
  })().catch((e) => {
    pending = null;
    throw e;
  }));
}
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  art: Art,
  name: string,
  x: number,
  y: number,
  width: number,
  alpha = 1,
) {
  const s = sprites[name];
  if (!s || !art[s.sheet]) return;
  const [sx, sy, sw, sh] = s.rect,
    ratio = width / sw;
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    art[s.sheet],
    sx,
    sy,
    sw,
    sh,
    x - s.anchor[0] * ratio,
    y - s.anchor[1] * ratio,
    sw * ratio,
    sh * ratio,
  );
  ctx.globalAlpha = 1;
}
export function Portrait({
  id = 0,
  size = 56,
}: {
  id?: number;
  size?: number;
}) {
  const col = Math.abs(id) % 4;
  return (
    <span
      aria-hidden="true"
      className="exp-portrait-art"
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${import.meta.env.BASE_URL}art/characters.png")`,
        backgroundSize: `${size * 8}px ${size * 8}px`,
        backgroundPosition: `-${col * size}px 0`,
      }}
    />
  );
}
